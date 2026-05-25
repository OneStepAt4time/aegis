/**
 * @vitest-environment node
 *
 * Tests for Issue #4203: Live Agent Status indicator.
 * Verifies deriveActivityText helper and latestActivityText propagation.
 */
import { describe, it, expect } from 'vitest';
import { deriveActivityText } from '../activity-text.js';

describe('deriveActivityText', () => {
  describe('PreToolUse events', () => {
    it('derives "Running: <command>" for Bash tool', () => {
      const result = deriveActivityText('PreToolUse', 'Bash', { command: 'npm test -- --run' });
      expect(result).toBe('Running: npm test -- --run');
    });

    it('truncates long Bash commands', () => {
      const longCmd = 'a'.repeat(100);
      const result = deriveActivityText('PreToolUse', 'Bash', { command: longCmd });
      expect(result).toBe(`Running: ${'a'.repeat(60)}`);
    });

    it('takes only first line of multi-line commands', () => {
      const result = deriveActivityText('PreToolUse', 'Bash', { command: 'npm test\nnpm run build' });
      expect(result).toBe('Running: npm test');
    });

    it('derives "Editing: <file>" for Edit tool', () => {
      const result = deriveActivityText('PreToolUse', 'Edit', { file_path: '/home/user/project/src/index.ts' });
      expect(result).toBe('Editing: index.ts');
    });

    it('derives "Editing: <file>" for MultiEdit tool', () => {
      const result = deriveActivityText('PreToolUse', 'MultiEdit', { file_path: '/home/user/project/src/app.tsx' });
      expect(result).toBe('Editing: app.tsx');
    });

    it('derives "Writing: <file>" for Write tool', () => {
      const result = deriveActivityText('PreToolUse', 'Write', { file_path: '/home/user/project/src/new-file.ts' });
      expect(result).toBe('Writing: new-file.ts');
    });

    it('derives "Reading: <file>" for Read tool', () => {
      const result = deriveActivityText('PreToolUse', 'Read', { file_path: '/home/user/project/README.md' });
      expect(result).toBe('Reading: README.md');
    });

    it('derives "Searching files" for Grep tool', () => {
      expect(deriveActivityText('PreToolUse', 'Grep')).toBe('Searching files');
    });

    it('derives "Searching files" for Glob tool', () => {
      expect(deriveActivityText('PreToolUse', 'Glob')).toBe('Searching files');
    });

    it('derives "Fetching URL" for WebFetch tool', () => {
      expect(deriveActivityText('PreToolUse', 'WebFetch')).toBe('Fetching URL');
    });

    it('derives "Updating task list" for TodoRead', () => {
      expect(deriveActivityText('PreToolUse', 'TodoRead')).toBe('Updating task list');
    });

    it('derives "Updating task list" for TodoWrite', () => {
      expect(deriveActivityText('PreToolUse', 'TodoWrite')).toBe('Updating task list');
    });

    it('derives "Running: <tool>" for unknown tools', () => {
      expect(deriveActivityText('PreToolUse', 'CustomTool')).toBe('Running: CustomTool');
    });

    it('returns "Working" when toolName is undefined', () => {
      expect(deriveActivityText('PreToolUse')).toBe('Working');
    });
  });

  describe('PostToolUse events', () => {
    it('derives activity text same as PreToolUse', () => {
      expect(deriveActivityText('PostToolUse', 'Bash', { command: 'ls' })).toBe('Running: ls');
    });
  });

  describe('Non-tool events', () => {
    it('returns "Idle" for Stop event', () => {
      expect(deriveActivityText('Stop')).toBe('Idle');
    });

    it('returns "Compacting context" for PreCompact', () => {
      expect(deriveActivityText('PreCompact')).toBe('Compacting context');
    });

    it('returns "Compaction complete" for PostCompact', () => {
      expect(deriveActivityText('PostCompact')).toBe('Compaction complete');
    });

    it('returns "Waiting for approval" for PermissionRequest', () => {
      expect(deriveActivityText('PermissionRequest')).toBe('Waiting for approval');
    });

    it('returns "MCP elicitation" for Elicitation', () => {
      expect(deriveActivityText('Elicitation')).toBe('MCP elicitation');
    });

    it('returns "Starting sub-agent" for SubagentStart', () => {
      expect(deriveActivityText('SubagentStart')).toBe('Starting sub-agent');
    });

    it('returns "Processing prompt" for UserPromptSubmit', () => {
      expect(deriveActivityText('UserPromptSubmit')).toBe('Processing prompt');
    });

    it('returns "Creating worktree" for WorktreeCreate', () => {
      expect(deriveActivityText('WorktreeCreate')).toBe('Creating worktree');
    });

    it('returns "Removing worktree" for WorktreeRemove', () => {
      expect(deriveActivityText('WorktreeRemove')).toBe('Removing worktree');
    });

    it('returns undefined for unknown events', () => {
      expect(deriveActivityText('UnknownEvent')).toBeUndefined();
    });
  });
});
