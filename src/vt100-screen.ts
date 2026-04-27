/**
 * VT100/ANSI terminal emulator — in-memory screen buffer.
 *
 * Maintains a virtual terminal that can be fed raw PTY output and queried for
 * the current visible screen content, cursor position, per-cell attributes,
 * and scrollback history.  Zero external dependencies.
 *
 * @module vt100-screen
 */

/** Per-cell visual attributes. */
export interface CellAttrs {
  fg: number;
  bg: number;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  blink: boolean;
  reverse: boolean;
  hidden: boolean;
}

const DEFAULT_ATTRS: CellAttrs = {
  fg: -1,
  bg: -1,
  bold: false,
  dim: false,
  underline: false,
  blink: false,
  reverse: false,
  hidden: false,
};

interface Cell {
  char: string;
  attrs: CellAttrs;
}

const MAX_SCROLLBACK = 1000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const TAB_WIDTH = 8;

function defaultCell(): Cell {
  return { char: ' ', attrs: { ...DEFAULT_ATTRS } };
}

function newRow(cols: number): Cell[] {
  const row: Cell[] = [];
  for (let i = 0; i < cols; i++) row.push(defaultCell());
  return row;
}

/**
 * Pure TypeScript VT100/ANSI terminal emulator.
 *
 * Maintains an in-memory screen buffer that can be fed raw terminal output
 * via {@link write} and queried for rendered content, cursor position,
 * per-cell attributes, and scrollback history.
 */
export class VT100Screen {
  private cols: number;
  private rows: number;
  private buffer: Cell[][];
  private cursorRow: number;
  private cursorCol: number;
  private savedCursorRow: number;
  private savedCursorCol: number;
  private scrollTop: number;
  private scrollBottom: number;
  private scrollback: string[];
  private attrs: CellAttrs;
  private cursorVisible: boolean;
  private usingAltScreen: boolean;
  private savedMainBuffer: Cell[][] | null;
  private savedMainCursorRow: number;
  private savedMainCursorCol: number;
  private tabStops: boolean[];
  private wrapPending: boolean;

  constructor(cols: number = DEFAULT_COLS, rows: number = DEFAULT_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.buffer = this.createBuffer(rows, cols);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.savedCursorRow = 0;
    this.savedCursorCol = 0;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.scrollback = [];
    this.attrs = { ...DEFAULT_ATTRS };
    this.cursorVisible = true;
    this.usingAltScreen = false;
    this.savedMainBuffer = null;
    this.savedMainCursorRow = 0;
    this.savedMainCursorCol = 0;
    this.tabStops = this.createDefaultTabStops(cols);
    this.wrapPending = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Feed raw terminal output (ANSI/VT100 escape sequences and plain text)
   * into the screen buffer.
   */
  write(data: string | Uint8Array): void {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.parse(str);
  }

  /** Return the visible screen content as a single string (rows joined by LF). */
  getText(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      lines.push(this.renderRow(r));
    }
    return lines.join('\n');
  }

  /** Return a single row of visible text (right-trimmed). */
  getRow(y: number): string {
    if (y < 0 || y >= this.rows) return '';
    return this.renderRow(y);
  }

  /** Return the current cursor position (0-based). */
  getCursor(): { row: number; col: number } {
    return { row: this.cursorRow, col: this.cursorCol };
  }

  /** Return the current scroll region margins (0-based, inclusive). */
  getScrollRegion(): { top: number; bottom: number } {
    return { top: this.scrollTop, bottom: this.scrollBottom };
  }

  /** Return lines that have scrolled off the top of the screen. */
  getScrollback(): string[] {
    return [...this.scrollback];
  }

  /** Resize the virtual terminal. Preserves content where possible. */
  resize(cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return;

    const newBuffer = this.createBuffer(rows, cols);

    const copyRows = Math.min(this.rows, rows);
    const copyCols = Math.min(this.cols, cols);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        newBuffer[r][c] = this.buffer[r][c];
      }
    }

    this.buffer = newBuffer;
    this.cols = cols;
    this.rows = rows;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.cursorRow = Math.min(this.cursorRow, rows - 1);
    this.cursorCol = Math.min(this.cursorCol, cols - 1);
    this.tabStops = this.createDefaultTabStops(cols);
    this.wrapPending = false;
  }

  /** Clear the screen and reset all state to defaults. */
  reset(): void {
    this.buffer = this.createBuffer(this.rows, this.cols);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.savedCursorRow = 0;
    this.savedCursorCol = 0;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.scrollback = [];
    this.attrs = { ...DEFAULT_ATTRS };
    this.cursorVisible = true;
    this.usingAltScreen = false;
    this.savedMainBuffer = null;
    this.savedMainCursorRow = 0;
    this.savedMainCursorCol = 0;
    this.tabStops = this.createDefaultTabStops(this.cols);
    this.wrapPending = false;
  }

  /** Return per-cell visual attributes at the given position. */
  getAttrs(row: number, col: number): CellAttrs {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return { ...DEFAULT_ATTRS };
    }
    return { ...this.buffer[row][col].attrs };
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private createBuffer(rows: number, cols: number): Cell[][] {
    const buf: Cell[][] = [];
    for (let r = 0; r < rows; r++) buf.push(newRow(cols));
    return buf;
  }

  private createDefaultTabStops(cols: number): boolean[] {
    const stops: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      stops.push(c % TAB_WIDTH === 0);
    }
    return stops;
  }

  private renderRow(r: number): string {
    const row = this.buffer[r];
    let end = this.cols;
    while (end > 0 && row[end - 1].char === ' ') end--;
    let result = '';
    for (let c = 0; c < end; c++) result += row[c].char;
    return result;
  }

  private putChar(ch: string): void {
    if (this.wrapPending) {
      this.cursorCol = 0;
      this.wrapPending = false;
      if (this.cursorRow === this.scrollBottom) {
        this.scrollUp();
      } else if (this.cursorRow < this.rows - 1) {
        this.cursorRow++;
      }
    }
    this.buffer[this.cursorRow][this.cursorCol] = {
      char: ch,
      attrs: { ...this.attrs },
    };
    if (this.cursorCol < this.cols - 1) {
      this.cursorCol++;
    } else {
      this.wrapPending = true;
    }
  }

  private scrollUp(): void {
    const topRow = this.buffer[this.scrollTop];
    this.pushScrollback(this.renderRow(this.scrollTop));
    for (let r = this.scrollTop; r < this.scrollBottom; r++) {
      this.buffer[r] = this.buffer[r + 1];
    }
    this.buffer[this.scrollBottom] = newRow(this.cols);
    // Reuse topRow cells object identity not required; newRow is fine.
    void topRow;
  }

  private scrollDown(): void {
    for (let r = this.scrollBottom; r > this.scrollTop; r--) {
      this.buffer[r] = this.buffer[r - 1];
    }
    this.buffer[this.scrollTop] = newRow(this.cols);
  }

  private pushScrollback(line: string): void {
    this.scrollback.push(line);
    if (this.scrollback.length > MAX_SCROLLBACK) {
      this.scrollback.shift();
    }
  }

  private lineFeed(): void {
    if (this.cursorRow === this.scrollBottom) {
      this.scrollUp();
    } else if (this.cursorRow < this.rows - 1) {
      this.cursorRow++;
    }
  }

  private reverseIndex(): void {
    if (this.cursorRow === this.scrollTop) {
      this.scrollDown();
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
    }
  }

  private clampCursor(): void {
    this.cursorRow = Math.max(0, Math.min(this.cursorRow, this.rows - 1));
    this.cursorCol = Math.max(0, Math.min(this.cursorCol, this.cols - 1));
  }

  // ── CSI parameter parsing ───────────────────────────────────────────────

  private parseCSI(params: string, intermediate: string, final: string): void {
    // Check for private mode sequences (e.g. ?25h, ?1049h)
    if (params.startsWith('?')) {
      this.handlePrivateMode(params.slice(1), final);
      return;
    }

    const parts = params.length > 0 ? params.split(';') : [];
    const p = (i: number, def: number): number => {
      const v = parts[i];
      return v && v.length > 0 ? parseInt(v, 10) : def;
    };

    this.wrapPending = false;

    switch (final) {
      // Cursor movement
      case 'A': { // CUU — cursor up
        const n = Math.max(p(0, 1), 1);
        this.cursorRow = Math.max(this.cursorRow - n, 0);
        break;
      }
      case 'B': { // CUD — cursor down
        const n = Math.max(p(0, 1), 1);
        this.cursorRow = Math.min(this.cursorRow + n, this.rows - 1);
        break;
      }
      case 'C': { // CUF — cursor forward
        const n = Math.max(p(0, 1), 1);
        this.cursorCol = Math.min(this.cursorCol + n, this.cols - 1);
        break;
      }
      case 'D': { // CUB — cursor back
        const n = Math.max(p(0, 1), 1);
        this.cursorCol = Math.max(this.cursorCol - n, 0);
        break;
      }
      case 'E': { // CNL — cursor next line
        const n = Math.max(p(0, 1), 1);
        this.cursorRow = Math.min(this.cursorRow + n, this.rows - 1);
        this.cursorCol = 0;
        break;
      }
      case 'F': { // CPL — cursor previous line
        const n = Math.max(p(0, 1), 1);
        this.cursorRow = Math.max(this.cursorRow - n, 0);
        this.cursorCol = 0;
        break;
      }
      case 'G': { // CHA — cursor horizontal absolute
        this.cursorCol = Math.max(0, Math.min(p(0, 1) - 1, this.cols - 1));
        break;
      }
      case 'H':   // CUP — cursor position
      case 'f': { // HVP — horizontal and vertical position
        this.cursorRow = Math.max(0, Math.min(p(0, 1) - 1, this.rows - 1));
        this.cursorCol = Math.max(0, Math.min(p(1, 1) - 1, this.cols - 1));
        break;
      }
      case 'J': { // ED — erase in display
        this.eraseDisplay(p(0, 0));
        break;
      }
      case 'K': { // EL — erase in line
        this.eraseLine(p(0, 0));
        break;
      }
      case 'L': { // IL — insert lines
        this.insertLines(Math.max(p(0, 1), 1));
        break;
      }
      case 'M': { // DL — delete lines
        this.deleteLines(Math.max(p(0, 1), 1));
        break;
      }
      case 'P': { // DCH — delete characters
        this.deleteChars(Math.max(p(0, 1), 1));
        break;
      }
      case '@': { // ICH — insert characters
        this.insertChars(Math.max(p(0, 1), 1));
        break;
      }
      case 'S': { // SU — scroll up
        for (let i = 0; i < Math.max(p(0, 1), 1); i++) this.scrollUp();
        break;
      }
      case 'T': { // SD — scroll down
        for (let i = 0; i < Math.max(p(0, 1), 1); i++) this.scrollDown();
        break;
      }
      case 'm': { // SGR — select graphic rendition
        this.handleSGR(parts);
        break;
      }
      case 'r': { // DECSTBM — set scrolling region
        this.scrollTop = Math.max(0, p(0, 1) - 1);
        this.scrollBottom = Math.min(this.rows - 1, p(1, this.rows) - 1);
        if (this.scrollTop >= this.scrollBottom) {
          this.scrollTop = 0;
          this.scrollBottom = this.rows - 1;
        }
        this.cursorRow = 0;
        this.cursorCol = 0;
        break;
      }
      case 'n': { // DSR — device status report
        if (p(0, 0) === 6) {
          // Response would be sent to the terminal input; we ignore it here
        }
        break;
      }
      case 'g': { // TBC — tabulation clear
        const mode = p(0, 0);
        if (mode === 0) {
          if (this.cursorCol < this.cols) this.tabStops[this.cursorCol] = false;
        } else if (mode === 3) {
          this.tabStops = this.createDefaultTabStops(this.cols);
          for (let c = 0; c < this.cols; c++) this.tabStops[c] = false;
        }
        break;
      }
      case 'X': { // ECH — erase characters
        const n = Math.max(p(0, 1), 1);
        for (let i = 0; i < n && this.cursorCol + i < this.cols; i++) {
          this.buffer[this.cursorRow][this.cursorCol + i] = defaultCell();
        }
        break;
      }
      default:
        // Unknown CSI sequence — ignore
        break;
    }
  }

  // ── SGR (Select Graphic Rendition) ──────────────────────────────────────

  private handleSGR(parts: string[]): void {
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
      this.attrs = { ...DEFAULT_ATTRS };
      return;
    }

    for (let i = 0; i < parts.length; i++) {
      const code = parts[i].length > 0 ? parseInt(parts[i], 10) : 0;
      switch (code) {
        case 0: this.attrs = { ...DEFAULT_ATTRS }; break;
        case 1: this.attrs.bold = true; break;
        case 2: this.attrs.dim = true; break;
        case 4: this.attrs.underline = true; break;
        case 5: this.attrs.blink = true; break;
        case 7: this.attrs.reverse = true; break;
        case 8: this.attrs.hidden = true; break;
        case 22: this.attrs.bold = false; this.attrs.dim = false; break;
        case 24: this.attrs.underline = false; break;
        case 25: this.attrs.blink = false; break;
        case 27: this.attrs.reverse = false; break;
        case 28: this.attrs.hidden = false; break;
        // Standard foreground colors 30–37
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          this.attrs.fg = code - 30;
          break;
        case 39: this.attrs.fg = -1; break;
        // Standard background colors 40–47
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          this.attrs.bg = code - 40;
          break;
        case 49: this.attrs.bg = -1; break;
        // Bright foreground colors 90–97
        case 90: case 91: case 92: case 93:
        case 94: case 95: case 96: case 97:
          this.attrs.fg = code - 90 + 8;
          break;
        // Bright background colors 100–107
        case 100: case 101: case 102: case 103:
        case 104: case 105: case 106: case 107:
          this.attrs.bg = code - 100 + 8;
          break;
        default:
          // Extended color (256-color, truecolor) — skip the extra params
          if (code === 38 || code === 48) {
            if (i + 1 < parts.length) {
              const type = parseInt(parts[i + 1], 10);
              if (type === 5 && i + 2 < parts.length) {
                // 256-color: 38;5;n or 48;5;n
                const color = parseInt(parts[i + 2], 10);
                if (code === 38) this.attrs.fg = color;
                else this.attrs.bg = color;
                i += 2;
              } else if (type === 2 && i + 4 < parts.length) {
                // Truecolor: 38;2;r;g;b — store as a combined index
                const r = parseInt(parts[i + 2], 10);
                const g = parseInt(parts[i + 3], 10);
                const b = parseInt(parts[i + 4], 10);
                const colorIdx = 16 + (r << 16) + (g << 8) + b;
                if (code === 38) this.attrs.fg = colorIdx;
                else this.attrs.bg = colorIdx;
                i += 4;
              }
            }
          }
          break;
      }
    }
  }

  // ── Private mode sequences (? prefix) ───────────────────────────────────

  private handlePrivateMode(params: string, final: string): void {
    const code = parseInt(params, 10);
    if (final === 'h') {
      switch (code) {
        case 25: this.cursorVisible = true; break;
        case 1049: this.enterAltScreen(); break;
      }
    } else if (final === 'l') {
      switch (code) {
        case 25: this.cursorVisible = false; break;
        case 1049: this.leaveAltScreen(); break;
      }
    }
  }

  private enterAltScreen(): void {
    if (this.usingAltScreen) return;
    this.savedMainBuffer = this.buffer;
    this.savedMainCursorRow = this.cursorRow;
    this.savedMainCursorCol = this.cursorCol;
    this.buffer = this.createBuffer(this.rows, this.cols);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.usingAltScreen = true;
  }

  private leaveAltScreen(): void {
    if (!this.usingAltScreen) return;
    if (this.savedMainBuffer) {
      this.buffer = this.savedMainBuffer;
      this.cursorRow = this.savedMainCursorRow;
      this.cursorCol = this.savedMainCursorCol;
    }
    this.savedMainBuffer = null;
    this.usingAltScreen = false;
  }

  // ── Erase operations ────────────────────────────────────────────────────

  private eraseDisplay(mode: number): void {
    switch (mode) {
      case 0: { // Cursor to end
        for (let c = this.cursorCol; c < this.cols; c++) {
          this.buffer[this.cursorRow][c] = defaultCell();
        }
        for (let r = this.cursorRow + 1; r < this.rows; r++) {
          this.buffer[r] = newRow(this.cols);
        }
        break;
      }
      case 1: { // Start to cursor
        for (let r = 0; r < this.cursorRow; r++) {
          this.buffer[r] = newRow(this.cols);
        }
        for (let c = 0; c <= this.cursorCol && c < this.cols; c++) {
          this.buffer[this.cursorRow][c] = defaultCell();
        }
        break;
      }
      case 2: { // Entire display
        for (let r = 0; r < this.rows; r++) {
          this.buffer[r] = newRow(this.cols);
        }
        break;
      }
      case 3: // Scrollback (often ignored in simple emulators)
        this.scrollback = [];
        break;
    }
  }

  private eraseLine(mode: number): void {
    switch (mode) {
      case 0: // Cursor to end
        for (let c = this.cursorCol; c < this.cols; c++) {
          this.buffer[this.cursorRow][c] = defaultCell();
        }
        break;
      case 1: // Start to cursor
        for (let c = 0; c <= this.cursorCol && c < this.cols; c++) {
          this.buffer[this.cursorRow][c] = defaultCell();
        }
        break;
      case 2: // Entire line
        this.buffer[this.cursorRow] = newRow(this.cols);
        break;
    }
  }

  // ── Insert / delete operations ──────────────────────────────────────────

  private insertLines(n: number): void {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return;
    for (let i = 0; i < n; i++) {
      // Remove the bottom line of the scroll region
      this.buffer.splice(this.scrollBottom, 1);
      // Insert a blank line at the cursor row
      this.buffer.splice(this.cursorRow, 0, newRow(this.cols));
    }
  }

  private deleteLines(n: number): void {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return;
    for (let i = 0; i < n; i++) {
      // Remove line at cursor
      this.buffer.splice(this.cursorRow, 1);
      // Insert blank line at bottom of scroll region
      this.buffer.splice(this.scrollBottom, 0, newRow(this.cols));
    }
  }

  private deleteChars(n: number): void {
    const row = this.buffer[this.cursorRow];
    for (let i = this.cursorCol; i < this.cols; i++) {
      const src = i + n;
      row[i] = src < this.cols ? row[src] : defaultCell();
    }
  }

  private insertChars(n: number): void {
    const row = this.buffer[this.cursorRow];
    for (let i = this.cols - 1; i >= this.cursorCol; i--) {
      const src = i - n;
      row[i] = src >= this.cursorCol ? row[src] : defaultCell();
    }
  }

  // ── Main parser state machine ───────────────────────────────────────────

  private parse(data: string): void {
    let i = 0;
    const len = data.length;

    while (i < len) {
      const ch = data[i];

      if (ch === '\x1b') {
        // Begin escape sequence
        if (i + 1 >= len) break; // incomplete — wait for more
        const next = data[i + 1];

        if (next === '[') {
          // CSI sequence: ESC [ <params> <final>
          i += 2;
          let params = '';
          let intermediate = '';
          while (i < len) {
            const c = data[i];
            if (c >= '\x30' && c <= '\x3f') {
              // Parameter bytes: 0–9, ;, <, =, >, ?
              params += c;
              i++;
            } else if (c >= '\x20' && c <= '\x2f') {
              // Intermediate bytes
              intermediate += c;
              i++;
            } else if (c >= '\x40' && c <= '\x7e') {
              // Final byte
              this.parseCSI(params, intermediate, c);
              i++;
              break;
            } else {
              // Unexpected byte in CSI — abort
              break;
            }
          }
        } else if (next === ']') {
          // OSC sequence: ESC ] <text> BEL (or ST)
          i += 2;
          let _oscText = '';
          while (i < len) {
            if (data[i] === '\x07') { i++; break; } // BEL terminates
            if (data[i] === '\x1b' && i + 1 < len && data[i + 1] === '\\') {
              i += 2; break; // ST terminates
            }
            _oscText += data[i];
            i++;
          }
          // Consume OSC (window title) — discard
        } else if (next === 'M') {
          // Reverse index
          this.reverseIndex();
          i += 2;
        } else if (next === '7') {
          // Save cursor
          this.savedCursorRow = this.cursorRow;
          this.savedCursorCol = this.cursorCol;
          this.wrapPending = false;
          i += 2;
        } else if (next === '8') {
          // Restore cursor
          this.cursorRow = this.savedCursorRow;
          this.cursorCol = this.savedCursorCol;
          this.wrapPending = false;
          i += 2;
        } else if (next === 'c') {
          // Full reset
          this.reset();
          i += 2;
        } else {
          // Unknown ESC sequence — skip ESC and the next char
          i += 2;
        }
      } else if (ch === '\r') {
        this.cursorCol = 0;
        this.wrapPending = false;
        i++;
      } else if (ch === '\n') {
        this.wrapPending = false;
        this.lineFeed();
        i++;
      } else if (ch === '\t') {
        // Advance to next tab stop
        this.wrapPending = false;
        let nextTab = this.cursorCol + 1;
        while (nextTab < this.cols - 1 && !this.tabStops[nextTab]) {
          nextTab++;
        }
        this.cursorCol = nextTab;
        i++;
      } else if (ch === '\x08') {
        // Backspace
        this.wrapPending = false;
        if (this.cursorCol > 0) this.cursorCol--;
        i++;
      } else if (ch === '\x07') {
        // BEL — ignore
        i++;
      } else if (ch >= ' ') {
        this.putChar(ch);
        i++;
      } else {
        // Other control characters — ignore
        i++;
      }
    }
  }
}
