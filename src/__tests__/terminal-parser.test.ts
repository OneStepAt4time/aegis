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

const UNKNOWN_PANE = `
Some random output
without any recognizable patterns
just plain text
`;

const EMPTY_PANE = '';

const CHROME_ONLY = `
────────────────────────────────────────────────────────────────────────────────
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
  });

  describe('unknown detection', () => {
    it('returns unknown for empty input', () => {
      expect(detectUIState(EMPTY_PANE)).toBe('unknown');
    });

    it('returns unknown for unrecognized patterns', () => {
      expect(detectUIState(UNKNOWN_PANE)).toBe('unknown');
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
