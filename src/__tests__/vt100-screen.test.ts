import { describe, it, expect } from 'vitest';
import { VT100Screen } from '../vt100-screen.js';

describe('VT100Screen', () => {
  // ── Basic text output ───────────────────────────────────────────────────

  describe('basic text output', () => {
    it('writes plain text to the screen', () => {
      const s = new VT100Screen(20, 5);
      s.write('Hello');
      expect(s.getRow(0)).toBe('Hello');
      expect(s.getCursor()).toEqual({ row: 0, col: 5 });
    });

    it('defaults to 80x24', () => {
      const s = new VT100Screen();
      s.write('\x1b[24;80H');
      expect(s.getCursor()).toEqual({ row: 23, col: 79 });
    });
  });

  // ── Cursor movement ─────────────────────────────────────────────────────

  describe('cursor movement', () => {
    it('CUU — cursor up (A)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[5;5H'); // row 4, col 4 (1-indexed → 0-indexed)
      s.write('\x1b[2A');
      expect(s.getCursor()).toEqual({ row: 2, col: 4 });
    });

    it('CUU clamps at top', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[2;1H');
      s.write('\x1b[5A');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
    });

    it('CUD — cursor down (B)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[2;2H');
      s.write('\x1b[3B');
      expect(s.getCursor()).toEqual({ row: 4, col: 1 });
    });

    it('CUF — cursor forward (C)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[1;1H');
      s.write('\x1b[5C');
      expect(s.getCursor()).toEqual({ row: 0, col: 5 });
    });

    it('CUB — cursor back (D)', () => {
      const s = new VT100Screen(20, 10);
      s.write('ABCDE');
      s.write('\x1b[2D');
      expect(s.getCursor()).toEqual({ row: 0, col: 3 });
    });

    it('CNL — cursor next line (E)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[3;8H');
      s.write('\x1b[2E');
      expect(s.getCursor()).toEqual({ row: 4, col: 0 });
    });

    it('CPL — cursor previous line (F)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[5;6H'); // row 4, col 5
      s.write('\x1b[3F');
      expect(s.getCursor()).toEqual({ row: 1, col: 0 });
    });

    it('CHA — cursor horizontal absolute (G)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[1;15H');
      s.write('\x1b[5G');
      expect(s.getCursor()).toEqual({ row: 0, col: 4 });
    });

    it('CUP — cursor position (H)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[5;10H');
      expect(s.getCursor()).toEqual({ row: 4, col: 9 });
    });

    it('HVP — horizontal vertical position (f)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[3;7f');
      expect(s.getCursor()).toEqual({ row: 2, col: 6 });
    });

    it('CUP defaults to 1;1', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[5;5H');
      s.write('\x1b[H');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
    });
  });

  // ── Line wrapping ───────────────────────────────────────────────────────

  describe('line wrapping', () => {
    it('wraps to next line when past last column', () => {
      const s = new VT100Screen(5, 5);
      s.write('ABCDE');
      expect(s.getRow(0)).toBe('ABCDE');
      // After filling all 5 cols, cursor is at col 4 with wrapPending
      expect(s.getCursor()).toEqual({ row: 0, col: 4 });
      s.write('F');
      expect(s.getRow(1)).toBe('F');
      expect(s.getCursor()).toEqual({ row: 1, col: 1 });
    });

    it('wraps multiple lines', () => {
      const s = new VT100Screen(3, 5);
      s.write('ABCDEFGHI');
      expect(s.getRow(0)).toBe('ABC');
      expect(s.getRow(1)).toBe('DEF');
      expect(s.getRow(2)).toBe('GHI');
    });

    it('scrolls when wrapping past last row', () => {
      const s = new VT100Screen(3, 2);
      s.write('ABCDEFGH');
      expect(s.getScrollback()).toEqual(['ABC']);
      expect(s.getRow(0)).toBe('DEF');
      expect(s.getRow(1)).toBe('GH');
    });
  });

  // ── CR and LF ───────────────────────────────────────────────────────────

  describe('CR and LF', () => {
    it('CR returns cursor to column 0', () => {
      const s = new VT100Screen(20, 5);
      s.write('Hello\rWorld');
      expect(s.getRow(0)).toBe('World');
    });

    it('LF moves to next line (does not reset column)', () => {
      const s = new VT100Screen(20, 5);
      s.write('Line1\r\nLine2');
      expect(s.getRow(0)).toBe('Line1');
      expect(s.getRow(1)).toBe('Line2');
    });

    it('CR+LF together', () => {
      const s = new VT100Screen(20, 5);
      s.write('A\r\nB');
      expect(s.getRow(0)).toBe('A');
      expect(s.getRow(1)).toBe('B');
    });
  });

  // ── Backspace ───────────────────────────────────────────────────────────

  describe('backspace', () => {
    it('moves cursor back one column', () => {
      const s = new VT100Screen(20, 5);
      s.write('AB\x08');
      expect(s.getCursor()).toEqual({ row: 0, col: 1 });
    });

    it('does not go below column 0', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x08\x08');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
    });
  });

  // ── Tab ─────────────────────────────────────────────────────────────────

  describe('tab', () => {
    it('advances to next tab stop (multiples of 8)', () => {
      const s = new VT100Screen(40, 5);
      s.write('A\tB');
      expect(s.getCursor()).toEqual({ row: 0, col: 9 });
      expect(s.getRow(0)).toBe('A       B');
    });

    it('tab from column 0 goes to column 8', () => {
      const s = new VT100Screen(40, 5);
      s.write('\tX');
      expect(s.getCursor()).toEqual({ row: 0, col: 9 });
    });
  });

  // ── CSI erase ───────────────────────────────────────────────────────────

  describe('erase display (J)', () => {
    it('ED 0 — erase from cursor to end', () => {
      const s = new VT100Screen(20, 5);
      s.write('AAAAAAAAAA\r\nBBBBBBBBBB\r\nCCCCCCCCCC');
      s.write('\x1b[2;3H\x1b[0J');
      expect(s.getRow(0)).toBe('AAAAAAAAAA');
      expect(s.getRow(1)).toBe('BB');
      expect(s.getRow(2)).toBe('');
    });

    it('ED 1 — erase from start to cursor', () => {
      const s = new VT100Screen(20, 5);
      s.write('AAAAAAAAAA\r\nBBBBBBBBBB\r\nCCCCCCCCCC');
      s.write('\x1b[3;3H\x1b[1J');
      expect(s.getRow(0)).toBe('');
      expect(s.getRow(1)).toBe('');
      expect(s.getRow(2)).toBe('   CCCCCCC'); // first 3 cols cleared (0,1,2)
    });

    it('ED 2 — erase entire display', () => {
      const s = new VT100Screen(20, 3);
      s.write('AAAAAAAAAA\r\nBBBBBBBBBB');
      s.write('\x1b[2J');
      expect(s.getText()).toBe('\n\n');
    });

    it('ED 3 — clear scrollback', () => {
      const s = new VT100Screen(5, 2);
      s.write('AAAAABBBBBCCCCC'); // scroll one line off
      expect(s.getScrollback().length).toBe(1);
      s.write('\x1b[3J');
      expect(s.getScrollback()).toEqual([]);
    });
  });

  describe('erase line (K)', () => {
    it('EL 0 — erase from cursor to end of line', () => {
      const s = new VT100Screen(20, 5);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;5H\x1b[0K');
      expect(s.getRow(0)).toBe('ABCD');
    });

    it('EL 1 — erase from start to cursor', () => {
      const s = new VT100Screen(20, 5);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;5H\x1b[1K');
      expect(s.getRow(0)).toBe('     FGHIJ');
    });

    it('EL 2 — erase entire line', () => {
      const s = new VT100Screen(20, 5);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;5H\x1b[2K');
      expect(s.getRow(0)).toBe('');
    });
  });

  // ── SGR attributes ──────────────────────────────────────────────────────

  describe('SGR attributes (m)', () => {
    it('reset (0)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[1;31mX\x1b[0mY');
      const xAttrs = s.getAttrs(0, 0);
      const yAttrs = s.getAttrs(0, 1);
      expect(xAttrs.bold).toBe(true);
      expect(xAttrs.fg).toBe(1);
      expect(yAttrs.bold).toBe(false);
      expect(yAttrs.fg).toBe(-1);
    });

    it('bold (1)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[1mX');
      expect(s.getAttrs(0, 0).bold).toBe(true);
    });

    it('dim (2)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[2mX');
      expect(s.getAttrs(0, 0).dim).toBe(true);
    });

    it('underline (4)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[4mX');
      expect(s.getAttrs(0, 0).underline).toBe(true);
    });

    it('blink (5)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[5mX');
      expect(s.getAttrs(0, 0).blink).toBe(true);
    });

    it('reverse (7)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[7mX');
      expect(s.getAttrs(0, 0).reverse).toBe(true);
    });

    it('hidden (8)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[8mX');
      expect(s.getAttrs(0, 0).hidden).toBe(true);
    });

    it('standard foreground colors (30-37)', () => {
      const s = new VT100Screen(20, 5);
      for (let i = 0; i < 8; i++) {
        s.write(`\x1b[${30 + i}mC`);
        expect(s.getAttrs(0, i).fg).toBe(i);
      }
    });

    it('standard background colors (40-47)', () => {
      const s = new VT100Screen(20, 5);
      for (let i = 0; i < 8; i++) {
        s.write(`\x1b[${40 + i}mC`);
        expect(s.getAttrs(0, i).bg).toBe(i);
      }
    });

    it('default fg/bg (39/49)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[31;44mX\x1b[39;49mY');
      expect(s.getAttrs(0, 0).fg).toBe(1);
      expect(s.getAttrs(0, 0).bg).toBe(4);
      expect(s.getAttrs(0, 1).fg).toBe(-1);
      expect(s.getAttrs(0, 1).bg).toBe(-1);
    });

    it('bright foreground (90-97)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[91mX');
      expect(s.getAttrs(0, 0).fg).toBe(9);
    });

    it('bright background (100-107)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[105mX');
      expect(s.getAttrs(0, 0).bg).toBe(13);
    });

    it('256-color foreground (38;5;n)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[38;5;200mX');
      expect(s.getAttrs(0, 0).fg).toBe(200);
    });

    it('truecolor foreground (38;2;r;g;b)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[38;2;100;150;200mX');
      expect(s.getAttrs(0, 0).fg).toBe(16 + (100 << 16) + (150 << 8) + 200);
    });

    it('combined SGR codes', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[1;3;4;31mX'); // bold, italic (ignored), underline, red fg
      const attrs = s.getAttrs(0, 0);
      expect(attrs.bold).toBe(true);
      expect(attrs.underline).toBe(true);
      expect(attrs.fg).toBe(1);
    });
  });

  // ── Scroll region ───────────────────────────────────────────────────────

  describe('scroll region', () => {
    it('sets scroll margins with DECSTBM (r)', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[3;7r');
      expect(s.getScrollRegion()).toEqual({ top: 2, bottom: 6 });
    });

    it('scrolls only within the region', () => {
      const s = new VT100Screen(5, 6);
      // Row 0-1 outside region, rows 2-4 inside region
      s.write('\x1b[3;5r');
      // Fill rows using explicit positioning
      s.write('\x1b[1;1HAAA');
      s.write('\x1b[2;1HBBB');
      s.write('\x1b[3;1HCCC');
      s.write('\x1b[4;1HDDD');
      s.write('\x1b[5;1HEEE');
      s.write('\x1b[6;1HFFF');
      // Cursor at row 4 (scroll bottom), LF should scroll region
      s.write('\x1b[5;1H\nXXX');
      expect(s.getRow(0)).toBe('AAA'); // unchanged
      expect(s.getRow(1)).toBe('BBB'); // unchanged
      expect(s.getRow(2)).toBe('DDD'); // CCC scrolled out
      expect(s.getRow(3)).toBe('EEE');
      expect(s.getRow(4)).toBe('XXX');
      expect(s.getRow(5)).toBe('FFF'); // unchanged
    });

    it('resets scroll region with no params', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[3;7r');
      s.write('\x1b[r');
      expect(s.getScrollRegion()).toEqual({ top: 0, bottom: 9 });
    });

    it('scroll up with CSI S', () => {
      const s = new VT100Screen(10, 4);
      s.write('AAAAA\r\nBBBBB\r\nCCCCC\r\nDDDDD');
      s.write('\x1b[2S'); // scroll up 2
      expect(s.getRow(0)).toBe('CCCCC');
      expect(s.getRow(1)).toBe('DDDDD');
      expect(s.getScrollback()).toEqual(['AAAAA', 'BBBBB']);
    });

    it('scroll down with CSI T', () => {
      const s = new VT100Screen(10, 4);
      s.write('AAAAA\r\nBBBBB\r\nCCCCC\r\nDDDDD');
      s.write('\x1b[2T'); // scroll down 2
      expect(s.getRow(0)).toBe('');
      expect(s.getRow(1)).toBe('');
      expect(s.getRow(2)).toBe('AAAAA');
      expect(s.getRow(3)).toBe('BBBBB');
    });
  });

  // ── Insert / delete lines ───────────────────────────────────────────────

  describe('insert / delete lines', () => {
    it('IL — insert lines (L)', () => {
      const s = new VT100Screen(10, 5);
      s.write('AAAAA\r\nBBBBB\r\nCCCCC\r\nDDDDD\r\nEEEEE');
      s.write('\x1b[3;1H\x1b[2L'); // insert 2 lines at row 2
      expect(s.getRow(0)).toBe('AAAAA');
      expect(s.getRow(1)).toBe('BBBBB');
      expect(s.getRow(2)).toBe('');
      expect(s.getRow(3)).toBe('');
      expect(s.getRow(4)).toBe('CCCCC'); // DDDDD and EEEEE pushed off
    });

    it('DL — delete lines (M)', () => {
      const s = new VT100Screen(10, 5);
      s.write('AAAAA\r\nBBBBB\r\nCCCCC\r\nDDDDD\r\nEEEEE');
      s.write('\x1b[2;1H\x1b[2M'); // delete 2 lines at row 1
      expect(s.getRow(0)).toBe('AAAAA');
      expect(s.getRow(1)).toBe('DDDDD');
      expect(s.getRow(2)).toBe('EEEEE');
      expect(s.getRow(3)).toBe('');
      expect(s.getRow(4)).toBe('');
    });
  });

  // ── Insert / delete characters ──────────────────────────────────────────

  describe('insert / delete characters', () => {
    it('ICH — insert characters (@)', () => {
      const s = new VT100Screen(10, 3);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;3H\x1b[3@'); // insert 3 at col 2
      expect(s.getRow(0)).toBe('AB   CDEFG');
    });

    it('DCH — delete characters (P)', () => {
      const s = new VT100Screen(10, 3);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;3H\x1b[3P'); // delete 3 at col 2
      expect(s.getRow(0)).toBe('ABFGHIJ');
    });
  });

  // ── OSC title ───────────────────────────────────────────────────────────

  describe('OSC title', () => {
    it('OSC 0 — set window title (consumed, discarded)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b]0;My Title\x07Hello');
      expect(s.getRow(0)).toBe('Hello');
    });

    it('OSC 2 — set window title (consumed, discarded)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b]2;Another Title\x07World');
      expect(s.getRow(0)).toBe('World');
    });

    it('OSC terminated with ST (ESC \\)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b]0;Title\x1b\\Hello');
      expect(s.getRow(0)).toBe('Hello');
    });
  });

  // ── Alt screen ──────────────────────────────────────────────────────────

  describe('alt screen', () => {
    it('switches to alt screen and back', () => {
      const s = new VT100Screen(10, 5);
      s.write('MainText');
      s.write('\x1b[?1049h'); // enter alt screen
      s.write('AltText');
      expect(s.getRow(0)).toBe('AltText');
      s.write('\x1b[?1049l'); // leave alt screen
      expect(s.getRow(0)).toBe('MainText');
    });

    it('restores cursor position', () => {
      const s = new VT100Screen(10, 5);
      s.write('\x1b[3;5H'); // cursor at row 2, col 4
      s.write('\x1b[?1049h'); // enter alt
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
      s.write('\x1b[?1049l'); // leave alt
      expect(s.getCursor()).toEqual({ row: 2, col: 4 });
    });
  });

  // ── Reverse index ───────────────────────────────────────────────────────

  describe('reverse index (ESC M)', () => {
    it('moves cursor up', () => {
      const s = new VT100Screen(10, 5);
      s.write('\x1b[3;1H'); // row 2
      s.write('\x1bM'); // reverse index
      expect(s.getCursor()).toEqual({ row: 1, col: 0 });
    });

    it('scrolls down when at top of scroll region', () => {
      const s = new VT100Screen(10, 3);
      s.write('AAAAAAAAAA\r\nBBBBBBBBBB\r\nCCCCCCCCCC');
      s.write('\x1b[1;1H\x1bM'); // at top row, reverse index
      expect(s.getRow(0)).toBe(''); // blank line inserted
      expect(s.getRow(1)).toBe('AAAAAAAAAA');
      expect(s.getRow(2)).toBe('BBBBBBBBBB');
    });
  });

  // ── Save / restore cursor ───────────────────────────────────────────────

  describe('save / restore cursor (ESC 7 / ESC 8)', () => {
    it('saves and restores cursor position', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[3;10H');
      s.write('\x1b7'); // save
      s.write('\x1b[1;1H');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
      s.write('\x1b8'); // restore
      expect(s.getCursor()).toEqual({ row: 2, col: 9 });
    });
  });

  // ── Tab stops ───────────────────────────────────────────────────────────

  describe('tab stops', () => {
    it('clears single tab stop with CSI 0g', () => {
      const s = new VT100Screen(40, 5);
      s.write('\x1b[1;9H'); // cursor at row 0, col 8 (the tab stop)
      s.write('\x1b[0g'); // clear it
      s.write('\x1b[1;1H\tX');
      // Tab stop at 8 removed, should pass through to next one at 16
      expect(s.getCursor()).toEqual({ row: 0, col: 17 });
    });

    it('clears all tab stops with CSI 3g', () => {
      const s = new VT100Screen(40, 5);
      s.write('\x1b[3g'); // clear all
      s.write('\tX');
      // No tab stops, cursor goes to end of line (col 39)
      expect(s.getCursor()).toEqual({ row: 0, col: 39 });
    });
  });

  // ── Resize ──────────────────────────────────────────────────────────────

  describe('resize', () => {
    it('resizes screen preserving content', () => {
      const s = new VT100Screen(10, 5);
      s.write('AAAAAAAAAA');
      s.resize(20, 3);
      expect(s.getRow(0)).toBe('AAAAAAAAAA');
      // After resize, cursor is clamped to new cols-1
      expect(s.getCursor()).toEqual({ row: 0, col: 9 });
    });

    it('clamps cursor to new dimensions', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[10;20H');
      s.resize(5, 3);
      expect(s.getCursor()).toEqual({ row: 2, col: 4 });
    });

    it('resets scroll region on resize', () => {
      const s = new VT100Screen(20, 10);
      s.write('\x1b[3;7r');
      s.resize(20, 10);
      expect(s.getScrollRegion()).toEqual({ top: 0, bottom: 9 });
    });
  });

  // ── Full reset ──────────────────────────────────────────────────────────

  describe('full reset (ESC c)', () => {
    it('clears everything', () => {
      const s = new VT100Screen(10, 5);
      s.write('AAAAA\r\nBBBBB');
      s.write('\x1b[1;31m');
      s.write('\x1bc');
      expect(s.getText()).toBe('\n\n\n\n');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
      expect(s.getScrollRegion()).toEqual({ top: 0, bottom: 4 });
      expect(s.getScrollback()).toEqual([]);
      // attrs should be reset — write a char and check
      s.write('X');
      expect(s.getAttrs(0, 0).bold).toBe(false);
      expect(s.getAttrs(0, 0).fg).toBe(-1);
    });
  });

  // ── Scrollback limits ───────────────────────────────────────────────────

  describe('scrollback limits', () => {
    it('caps scrollback at 1000 lines', () => {
      const s = new VT100Screen(10, 1); // wider to avoid wrapping
      for (let i = 0; i < 1010; i++) {
        s.write(`L${String(i).padStart(3, '0')}\r\n`);
      }
      expect(s.getScrollback().length).toBe(1000);
      // First 10 entries shifted out, first remaining is L010
      expect(s.getScrollback()[0]).toBe('L010');
    });
  });

  // ── Cursor visibility ───────────────────────────────────────────────────

  describe('cursor visibility', () => {
    it('show cursor (?25h)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[?25l');
      s.write('\x1b[?25h');
      // No crash, no state corruption — just a side-effect flag
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
    });

    it('hide cursor (?25l)', () => {
      const s = new VT100Screen(20, 5);
      s.write('\x1b[?25l');
      expect(s.getCursor()).toEqual({ row: 0, col: 0 });
    });
  });

  // ── BEL ─────────────────────────────────────────────────────────────────

  describe('BEL', () => {
    it('is ignored without side effects', () => {
      const s = new VT100Screen(20, 5);
      s.write('A\x07B');
      expect(s.getRow(0)).toBe('AB');
    });
  });

  // ── Uint8Array input ────────────────────────────────────────────────────

  describe('Uint8Array input', () => {
    it('accepts Uint8Array data', () => {
      const s = new VT100Screen(20, 5);
      s.write(new TextEncoder().encode('Hello'));
      expect(s.getRow(0)).toBe('Hello');
    });
  });

  // ── getRow bounds ───────────────────────────────────────────────────────

  describe('getRow bounds', () => {
    it('returns empty string for out-of-range rows', () => {
      const s = new VT100Screen(20, 5);
      expect(s.getRow(-1)).toBe('');
      expect(s.getRow(99)).toBe('');
    });
  });

  // ── getAttrs bounds ─────────────────────────────────────────────────────

  describe('getAttrs bounds', () => {
    it('returns default attrs for out-of-range positions', () => {
      const s = new VT100Screen(20, 5);
      const attrs = s.getAttrs(-1, -1);
      expect(attrs.fg).toBe(-1);
      expect(attrs.bold).toBe(false);
    });
  });

  // ── getText ─────────────────────────────────────────────────────────────

  describe('getText', () => {
    it('returns all rows joined by LF', () => {
      const s = new VT100Screen(20, 3);
      s.write('AA\r\nBB');
      const text = s.getText();
      expect(text).toBe('AA\nBB\n');
    });
  });

  // ── DSR ─────────────────────────────────────────────────────────────────

  describe('DSR (device status report)', () => {
    it('DSR 6n is consumed without error', () => {
      const s = new VT100Screen(20, 5);
      s.write('A\x1b[6nB');
      expect(s.getRow(0)).toBe('AB');
    });
  });

  // ── ECH — erase characters ──────────────────────────────────────────────

  describe('ECH — erase characters (X)', () => {
    it('erases N characters at cursor', () => {
      const s = new VT100Screen(10, 3);
      s.write('ABCDEFGHIJ');
      s.write('\x1b[1;3H\x1b[3X'); // erase 3 at col 2
      expect(s.getRow(0)).toBe('AB   FGHIJ');
    });
  });
});
