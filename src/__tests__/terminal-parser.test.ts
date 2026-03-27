import { describe, it, expect } from 'vitest';
import { detectUIState, parseStatusLine, extractInteractiveContent } from '../terminal-parser.js';

// Captured pane samples (based on real CC terminal output patterns)

const IDLE_PANE = `
────────────────────────────────────────────────────────────────────────────────
❯
`;

const IDLE_WITH_PROMPT = `
Some previous output here...

────────────────────────────────────────────────────────────────────────────────
❯ Type your message...
`;

const WORKING_SPINNER = `
· Reading files...

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_STATUS = `
✻ Working on your request...

Some content being generated...

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_PERAMBULATING = `
* Perambulating… (2m 27s · ↑ 4.5k tokens)

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_BULLET_STATUS = `
● Reading file…

────────────────────────────────────────────────────────────────────────────────
`;

const WORKED_FOR = `
✻ Worked for 45s

────────────────────────────────────────────────────────────────────────────────
❯
`;

const PERMISSION_PROMPT = `
Do you want to proceed?

  1. Yes
  2. No

  Esc to cancel

────────────────────────────────────────────────────────────────────────────────
`;

const PERMISSION_EDIT = `
Do you want to make this edit?

File: src/config.ts

  1. Yes, always for this file
  2. Yes
  3. No

  Esc to cancel

`;

const PERMISSION_MCP_TOOL = `
Do you want to allow Claude to use the GitHub MCP tool?

  1. Yes, always
  2. Yes
  3. No

  Esc to cancel

`;

const PERMISSION_BATCH_EDIT = `
Do you want to allow Claude to make these changes?

  3 files will be modified

  1. Yes
  2. No

  Esc to cancel

`;

const PERMISSION_WORKSPACE_TRUST = `
Do you want to trust this workspace?

  /home/user/projects/my-app

  1. Yes
  2. No

  Esc to cancel

`;

const PERMISSION_CONTINUE = `
Continue?

  1. Yes
  2. No

  Esc to cancel

`;

const PLAN_MODE = `
Would you like to proceed?

Here is the plan:
1. Read the file
2. Modify the function
3. Run tests

  ctrl-g to edit in $EDITOR
  Esc to cancel

────────────────────────────────────────────────────────────────────────────────
`;

const ASK_QUESTION = `
☐ Option A
✔ Option B
☒ Option C

  Enter to select
  Esc to go back

`;

const BASH_APPROVAL = `
Bash command

  npm run build

This command requires approval.

  Enter to confirm
  Esc to cancel

`;

const SETTINGS = `
Settings: tab to cycle

  Model: claude-sonnet-4-6
  Theme: dark

  Esc to exit
  Enter to confirm

`;

const WORKING_BRAILLE_SPINNER = `
⠙ Reading file…

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_BRAILLE_DOTS8 = `
⣾ Analyzing code...

────────────────────────────────────────────────────────────────────────────────
`;

const ERROR_API = `
API error: model overloaded, please retry

❯
`;

const ERROR_RATE_LIMIT = `
Rate limit exceeded. Please wait before trying again.

❯
`;

const ERROR_AUTH = `
Error: Authentication failed. Check your API key.

❯
`;

const WORKING_BRAILLE_SPINNER_CYCLE = `
⠋ Reading file…
────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_BRAILLE_SPINNER_MID = `
⠼ Analyzing code…

────────────────────────────────────────────────────────────────────────────────
`;

const ASK_QUESTION_MCP_TOOL = `
Allow MCP server github to use tool create_issue?
☐ Yes, always
☐ Yes
☐ No

  Enter to select
  Esc to go back

`;

const IDLE_TRUNCATED = `
Previous output here
More previous output
And even more text
`;

const SETTINGS_FALSE_POSITIVE = `
I checked the project settings.json file and found some issues.
The configuration settings are correct.

────────────────────────────────────────────────────────────────────────────────
❯
`;

const TRANSIENT_RENDER_PARTIAL = `
  const server = fast
  const port = 91
`;

const TRANSIENT_RERENDER_MIDDRAW = `
│   ● Reading src/ser│
│                    │
│   ⠙ Analyzing co  │

`;

const PERMISSION_LONG_DIFF = `
Do you want to make this edit?

File: src/session.ts
  @@ -120,10 +120,15 @@ export class SessionManager {
       private sessions: Map<string, Session>;
  +    private readonly maxSessions: number;
  +    private readonly reaperInterval: NodeJS.Timeout;
  -    constructor() {
  +    constructor(options?: { maxSessions?: number }) {
  +      this.maxSessions = options?.maxSessions ?? 100;
       this.sessions = new Map();
       }
  @@ -250,6 +255,18 @@ export class SessionManager {
       return session;
     }
  +  private startReaper(): void {
  +    this.reaperInterval = setInterval(() => {
  +      this.reapSessions();
  +    }, 60_000);
  +  }
  1. Yes, always for this file
  2. Yes
  3. No

  Esc to cancel

`;

const CHROME_SEPARATOR_FALSE_POSITIVE_EQ = `
====================================================================
                     Build Summary
====================================================================
  Packages: 42
  Duration: 12.4s

────────────────────────────────────────────────────────────────────────────────
❯
`;

const CHROME_SEPARATOR_FALSE_POSITIVE_DASH = `
--------------------------------------------------------------------
                    Test Results
--------------------------------------------------------------------
  Passed: 128
  Failed: 0

────────────────────────────────────────────────────────────────────────────────
❯
`;

const MULTIPLE_STATES_PERMISSION_AND_RESULT = `
Here is the result of the search:

Found 3 matches in src/session.ts:
  line 42: private sessions = new Map();
  line 88: this.sessions.set(id, session);
  line 156: return this.sessions.get(id);

Do you want to proceed?

  1. Yes
  2. No

  Esc to cancel

`;

const UNKNOWN_PANE = `
Some random output
without any recognizable patterns
just plain text
`;

const EMPTY_PANE = '';

const CHROME_ONLY = `
────────────────────────────────────────────────────────────────────────────────
`;

// M5: spinner without ellipsis
const WORKING_SPINNER_NO_ELLIPSIS = `
✻ Thinking

────────────────────────────────────────────────────────────────────────────────
`;

// L16: aborted state should NOT be detected as working
const ABORTED_SPINNER = `
✻ Aborted

────────────────────────────────────────────────────────────────────────────────
❯
`;

const ABORTED_STATUS_LINE = `
✻ Aborted — waiting for user input

────────────────────────────────────────────────────────────────────────────────
❯
`;

const ABORTED_LOWERCASE = `
· aborted by user

────────────────────────────────────────────────────────────────────────────────
❯
`;

// L30: compacting state
const COMPACTING_SPINNER = `
· Compacting conversation...

────────────────────────────────────────────────────────────────────────────────
`;

const COMPACTING_STATUS = `
✻ Compacting context to save tokens

────────────────────────────────────────────────────────────────────────────────
`;

const COMPACTING_PLAIN = `
Compacting...

────────────────────────────────────────────────────────────────────────────────
`;

// L30: "Compacted" (past tense) should NOT be detected as compacting — it's done
const COMPACTED_DONE = `
✻ Compacted context (saved 40% of tokens)

────────────────────────────────────────────────────────────────────────────────
❯
`;

// L31: context window warning
const CONTEXT_WARNING_80 = `
Context window 80% full — consider starting a new conversation

────────────────────────────────────────────────────────────────────────────────
❯
`;

const CONTEXT_WARNING_95 = `
⚠ Context window 95% full. Claude may not be able to continue this conversation much longer.

❯
`;

// L32: waiting for input (no chrome separator)
const WAITING_FOR_INPUT_QUESTION = `
What would you like to do?
`;

const WAITING_FOR_INPUT_PROMPT = `
Some previous output

❯ Type your message...
`;

const WAITING_FOR_INPUT_HOW = `
How should I approach this task?
`;

// L32: idle with chrome separator (should remain idle, not waiting_for_input)
const IDLE_WITH_CHROME_AND_TEXT = `
────────────────────────────────────────────────────────────────────────────────
❯ Type your message...
`;

// M6: partial idle prompt
const IDLE_PARTIAL_INPUT = `
────────────────────────────────────────────────────────────────────────────────
❯ fix the auth bug in session.ts
`;

// M20: settings with indented bottom patterns
const SETTINGS_INDENTED = `
Settings: tab to cycle

  Model: claude-sonnet-4-6
  Theme: dark

  Esc to exit
  Enter to confirm

`;

// M21: scrollback text that should NOT match
const SCROLLBACK_WITH_OLD_ERROR = `
Error: API error from two minutes ago
Some old output...
More old conversation text...
Yet another line of old text...
Another old line here...
And another one...
Yet more scrollback...
Still scrolling...
Old content continues...
More old lines...
Scrolling further back...
Ancient history here...
Deep scrollback content...
Even more old text...
Really old stuff...
Prehistoric terminal output...
Ancient scrollback line 1...
Ancient scrollback line 2...
Ancient scrollback line 3...
Ancient scrollback line 4...
Ancient scrollback line 5...
Ancient scrollback line 6...
Ancient scrollback line 7...
Ancient scrollback line 8...
Ancient scrollback line 9...
Ancient scrollback line 10...
Ancient scrollback line 11...
Ancient scrollback line 12...
Ancient scrollback line 13...
Ancient scrollback line 14...
Ancient scrollback line 15...
Ancient scrollback line 16...
Ancient scrollback line 17...
Ancient scrollback line 18...
Ancient scrollback line 19...
Ancient scrollback line 20...
Recent line 1
Recent line 2
❯
`;

describe('detectUIState', () => {
  describe('idle detection', () => {
    it('detects idle with prompt', () => {
      expect(detectUIState(IDLE_PANE)).toBe('idle');
    });

    it('detects idle with prompt text', () => {
      expect(detectUIState(IDLE_WITH_PROMPT)).toBe('idle');
    });

    it('detects idle after work completion (Worked for)', () => {
      expect(detectUIState(WORKED_FOR)).toBe('idle');
    });

    it('detects idle with chrome separator only', () => {
      expect(detectUIState(CHROME_ONLY)).toBe('idle');
    });

    it('detects idle with partial prompt text (M6: ❯ some text)', () => {
      expect(detectUIState(IDLE_PARTIAL_INPUT)).toBe('idle');
    });
  });

  describe('working detection', () => {
    it('detects working with spinner', () => {
      expect(detectUIState(WORKING_SPINNER)).toBe('working');
    });

    it('detects working with status text', () => {
      expect(detectUIState(WORKING_STATUS)).toBe('working');
    });



    it('detects working with braille spinner (⠙)', () => {
      expect(detectUIState(WORKING_BRAILLE_SPINNER)).toBe('working');
    });

    it('detects working with 8-dot braille spinner (⣾)', () => {
      expect(detectUIState(WORKING_BRAILLE_DOTS8)).toBe('working');
    });

    it('detects working with asterisk status (* Perambulating…)', () => {
      expect(detectUIState(WORKING_PERAMBULATING)).toBe('working');
    });

    it('detects working with bullet status (● Reading…)', () => {
      expect(detectUIState(WORKING_BULLET_STATUS)).toBe('working');
    });

    it('detects working with spinner without ellipsis (M5: ✻ Thinking)', () => {
      expect(detectUIState(WORKING_SPINNER_NO_ELLIPSIS)).toBe('working');
    });

    it('L18: detects working with braille spinner start (⠋)', () => {
      expect(detectUIState(WORKING_BRAILLE_SPINNER_CYCLE)).toBe('working');
    });

    it('L18: detects working with braille spinner mid-cycle (⠼)', () => {
      expect(detectUIState(WORKING_BRAILLE_SPINNER_MID)).toBe('working');
    });

    it('L16: "Aborted" with spinner is NOT detected as working', () => {
      expect(detectUIState(ABORTED_SPINNER)).not.toBe('working');
    });

    it('L16: "Aborted" status line is NOT detected as working', () => {
      expect(detectUIState(ABORTED_STATUS_LINE)).not.toBe('working');
    });

    it('L16: lowercase "aborted" with spinner is NOT detected as working', () => {
      expect(detectUIState(ABORTED_LOWERCASE)).not.toBe('working');
    });
  });

  describe('permission_prompt detection', () => {
    it('detects permission prompt with options', () => {
      expect(detectUIState(PERMISSION_PROMPT)).toBe('permission_prompt');
    });

    it('detects permission prompt for edits', () => {
      expect(detectUIState(PERMISSION_EDIT)).toBe('permission_prompt');
    });

    it('detects MCP tool permission prompt', () => {
      expect(detectUIState(PERMISSION_MCP_TOOL)).toBe('permission_prompt');
    });

    it('detects batch edit permission prompt', () => {
      expect(detectUIState(PERMISSION_BATCH_EDIT)).toBe('permission_prompt');
    });

    it('detects workspace trust permission prompt', () => {
      expect(detectUIState(PERMISSION_WORKSPACE_TRUST)).toBe('permission_prompt');
    });

    it('detects continuation permission prompt', () => {
      expect(detectUIState(PERMISSION_CONTINUE)).toBe('permission_prompt');
    });
  });

  describe('plan_mode detection', () => {
    it('detects plan mode', () => {
      expect(detectUIState(PLAN_MODE)).toBe('plan_mode');
    });
  });

  describe('ask_question detection', () => {
    it('detects ask_question with checkboxes', () => {
      expect(detectUIState(ASK_QUESTION)).toBe('ask_question');
    });

    it('L19: detects MCP tool permission as ask_question', () => {
      expect(detectUIState(ASK_QUESTION_MCP_TOOL)).toBe('ask_question');
    });
  });

  describe('bash_approval detection', () => {
    it('detects bash approval', () => {
      expect(detectUIState(BASH_APPROVAL)).toBe('bash_approval');
    });
  });

  describe('settings detection', () => {
    it('detects settings modal', () => {
      expect(detectUIState(SETTINGS)).toBe('settings');
    });

    it('detects settings with indented bottom patterns (M20)', () => {
      expect(detectUIState(SETTINGS_INDENTED)).toBe('settings');
    });
  });

  describe('error detection', () => {
    it('detects API error with prompt', () => {
      expect(detectUIState(ERROR_API)).toBe('error');
    });

    it('detects rate limit error with prompt', () => {
      expect(detectUIState(ERROR_RATE_LIMIT)).toBe('error');
    });

    it('detects authentication error with prompt', () => {
      expect(detectUIState(ERROR_AUTH)).toBe('error');
    });
  });

  describe('unknown detection', () => {
    it('returns unknown for empty input', () => {
      expect(detectUIState(EMPTY_PANE)).toBe('unknown');
    });

    it('returns unknown for unrecognized patterns', () => {
      expect(detectUIState(UNKNOWN_PANE)).toBe('unknown');
    });

    it('L22: returns unknown or working for transient partial render (mid-draw)', () => {
      const state = detectUIState(TRANSIENT_RENDER_PARTIAL);
      expect(['unknown', 'working']).toContain(state);
    });

    it('L22: returns unknown or working for transient re-render mid-draw artifacts', () => {
      const state = detectUIState(TRANSIENT_RERENDER_MIDDRAW);
      expect(['unknown', 'working']).toContain(state);
    });
  });

  describe('scrollback filtering (M21)', () => {
    it('does not match error text in scrollback beyond 30 lines', () => {
      // The "Error:" line is in scrollback (>30 lines from end), current state has bare ❯
      // Without chrome separator, bare ❯ is waiting_for_input (L32), not idle
      expect(detectUIState(SCROLLBACK_WITH_OLD_ERROR)).toBe('waiting_for_input');
    });
  });

  describe('negative / false-positive tests', () => {
    it('L20: truncated idle prompt (chrome only, no ❯) is NOT detected as idle', () => {
      // Only has chrome separator, no prompt character — should NOT be idle
      expect(detectUIState(IDLE_TRUNCATED)).not.toBe('idle');
    });

    it('L21: "settings" in prose context is NOT detected as settings modal', () => {
      expect(detectUIState(SETTINGS_FALSE_POSITIVE)).not.toBe('settings');
    });

    it('L35: lines of = (ASCII art) are NOT detected as ask_question chrome separator', () => {
      expect(detectUIState(CHROME_SEPARATOR_FALSE_POSITIVE_EQ)).not.toBe('ask_question');
    });

    it('L35: lines of - (ASCII art) are NOT detected as ask_question chrome separator', () => {
      expect(detectUIState(CHROME_SEPARATOR_FALSE_POSITIVE_DASH)).not.toBe('ask_question');
    });
  });

  describe('permission prompt edge cases', () => {
    it('L34: permission prompt with 100+ line diff preview is still detected', () => {
      expect(detectUIState(PERMISSION_LONG_DIFF)).toBe('permission_prompt');
    });

    it('L36: pane with tool result + permission prompt detects permission_prompt', () => {
      expect(detectUIState(MULTIPLE_STATES_PERMISSION_AND_RESULT)).toBe('permission_prompt');
    });
  });

  describe('L30: compacting detection', () => {
    it('active compacting with spinner is working (spinner takes priority)', () => {
      // Issue #362 fix #2: active spinners should be working, not compacting,
      // to ensure stall detection monitors these correctly
      expect(detectUIState(COMPACTING_SPINNER)).toBe('working');
    });

    it('active compacting with status text is working (spinner takes priority)', () => {
      expect(detectUIState(COMPACTING_STATUS)).toBe('working');
    });

    it('detects compacting plain text (no spinner)', () => {
      expect(detectUIState(COMPACTING_PLAIN)).toBe('compacting');
    });

    it('"Compacted" (past tense) is NOT detected as compacting', () => {
      expect(detectUIState(COMPACTED_DONE)).not.toBe('compacting');
    });
  });

  describe('L31: context window warning detection', () => {
    it('detects context window 80% full warning', () => {
      expect(detectUIState(CONTEXT_WARNING_80)).toBe('context_warning');
    });

    it('detects context window 95% full warning', () => {
      expect(detectUIState(CONTEXT_WARNING_95)).toBe('context_warning');
    });
  });

  describe('L32: waiting_for_input vs idle differentiation', () => {
    it('detects waiting_for_input for "What would you like to do?"', () => {
      expect(detectUIState(WAITING_FOR_INPUT_QUESTION)).toBe('waiting_for_input');
    });

    it('detects waiting_for_input for ❯ with text and no chrome', () => {
      expect(detectUIState(WAITING_FOR_INPUT_PROMPT)).toBe('waiting_for_input');
    });

    it('detects waiting_for_input for "How should I" question', () => {
      expect(detectUIState(WAITING_FOR_INPUT_HOW)).toBe('waiting_for_input');
    });

    it('idle with chrome separator + prompt text stays idle (not waiting_for_input)', () => {
      expect(detectUIState(IDLE_WITH_CHROME_AND_TEXT)).toBe('idle');
    });

    it('idle with bare prompt and chrome stays idle', () => {
      expect(detectUIState(IDLE_PANE)).toBe('idle');
    });

    it('idle with prompt text and chrome stays idle', () => {
      expect(detectUIState(IDLE_WITH_PROMPT)).toBe('idle');
    });
  });

  describe('priority', () => {
    it('interactive patterns take priority over working', () => {
      // Permission prompt should be detected even if there's a spinner
      const mixedPane = `
· Processing...

Do you want to proceed?

  Esc to cancel

`;
      expect(detectUIState(mixedPane)).toBe('permission_prompt');
    });
  });

  // Issue #362 edge case tests
  describe('issue #362: error regex anchoring', () => {
    it('"429" in middle of line is NOT detected as error', () => {
      const pane = `
The server returned HTTP 429 which we handled with retry logic.

────────────────────────────────────────────────────────────────────────────────
❯
`;
      expect(detectUIState(pane)).toBe('idle');
    });

    it('"Error:" in middle of line is NOT detected as error', () => {
      const pane = `
The function handles Error: cases gracefully and returns null.

────────────────────────────────────────────────────────────────────────────────
❯
`;
      expect(detectUIState(pane)).toBe('idle');
    });

    it('"429" at line start IS detected as error', () => {
      const pane = `
429 Too Many Requests

❯
`;
      expect(detectUIState(pane)).toBe('error');
    });

    it('"Error:" at line start IS detected as error', () => {
      const pane = `
Error: Something went wrong

❯
`;
      expect(detectUIState(pane)).toBe('error');
    });
  });

  describe('issue #362: markdown bullet false positive', () => {
    it('markdown bullet "* Fixed the auth bug" is NOT detected as working', () => {
      const pane = `
* Fixed the auth bug
* Added a new feature
* Cleaned up tests

────────────────────────────────────────────────────────────────────────────────
❯
`;
      expect(detectUIState(pane)).not.toBe('working');
    });

    it('spinner with asterisk and ellipsis "* Perambulating…" IS detected as working', () => {
      const pane = `
* Perambulating… (2m 27s)

────────────────────────────────────────────────────────────────────────────────
`;
      expect(detectUIState(pane)).toBe('working');
    });
  });

  describe('issue #362: tryMatchPattern backtracking', () => {
    it('matches second top when first has no matching bottom', () => {
      // First "Would you like to proceed?" has no "Esc to cancel" nearby,
      // but the second one does — should match the second one
      const pane = `
Would you like to proceed?
Some old text without matching bottom
More text here
Even more text
Would you like to proceed?

  ctrl-g to edit in $EDITOR
  Esc to cancel

────────────────────────────────────────────────────────────────────────────────
`;
      expect(detectUIState(pane)).toBe('plan_mode');
    });
  });
});

describe('parseStatusLine', () => {
  it('extracts status text from spinner line', () => {
    const status = parseStatusLine(WORKING_SPINNER);
    expect(status).toContain('Reading');
  });

  it('returns null for idle pane', () => {
    expect(parseStatusLine(IDLE_PANE)).toBeNull();
  });

  it('returns null for empty pane', () => {
    expect(parseStatusLine(EMPTY_PANE)).toBeNull();
  });

  it('handles Worked for completion status', () => {
    const status = parseStatusLine(WORKED_FOR);
    expect(status).toContain('Worked for');
  });

  it('L17: detects status line 7 lines above separator', () => {
    // Build pane with spinner 7 lines above separator, only empty lines in between
    const lines = ['· Analyzing code structure...', '', '', '', '', '', '', '────────────────────────────────────────────────────────────────────────────────'];
    const pane = lines.join('\n') + '\n';
    // Previously the 5-line scan limit would miss this
    const status = parseStatusLine(pane);
    expect(status).toContain('Analyzing code structure');
  });

  it('issue #362: finds spinner past tool output between spinner and separator', () => {
    // Tool output between the spinner and the chrome separator should not block detection
    const pane = `· Reading files...
Tool output line 1
Tool output line 2
Tool output line 3

────────────────────────────────────────────────────────────────────────────────
`;
    const status = parseStatusLine(pane);
    expect(status).toContain('Reading files');
  });
});

describe('extractInteractiveContent', () => {
  it('extracts permission prompt content', () => {
    const result = extractInteractiveContent(PERMISSION_PROMPT);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('permission_prompt');
    expect(result?.content).toContain('Do you want to proceed');
  });

  it('extracts plan mode content', () => {
    const result = extractInteractiveContent(PLAN_MODE);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('plan_mode');
    expect(result?.content).toContain('Would you like to proceed');
  });

  it('returns null for non-interactive content', () => {
    expect(extractInteractiveContent(IDLE_PANE)).toBeNull();
    expect(extractInteractiveContent(WORKING_SPINNER)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractInteractiveContent(EMPTY_PANE)).toBeNull();
  });
});
