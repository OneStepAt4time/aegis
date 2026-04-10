/**
 * permission-evaluator-coverage-1305.test.ts — Additional coverage tests for Issue #1305.
 *
 * Targets uncovered branches in src/services/permission/evaluator.ts:
 * - Pattern matching with JSON.stringify fallback (no command field in toolInput)
 * - readOnly constraint with non-write tool (should allow)
 * - Path constraint with empty paths array (no constraint applied)
 * - maxFileSize with null content (no size check)
 * - Multiple rules — first non-matching tool falls through
 * - Case-insensitive glob matching
 * - Path constraint allowing exact match and nested paths
 * - "ask" behavior passthrough
 * - toolInput undefined handling
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { evaluatePermissionProfile, type PermissionProfile } from '../services/permission/index.js';

describe('Issue #1305: permission evaluator additional coverage', () => {
  // ── Pattern matching ────────────────────────────────────────────────

  describe('Pattern matching with JSON.stringify fallback', () => {
    it('should use JSON.stringify of toolInput when command is not a string', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Read',
          behavior: 'allow',
          pattern: '*',
        }],
      }, {
        toolName: 'Read',
        toolInput: { file_path: '/tmp/test.ts' },
      });

      // * matches anything — should match the JSON.stringify output
      expect(result.behavior).toBe('allow');
    });

    it('should use JSON.stringify of empty object when toolInput is undefined', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Read',
          behavior: 'allow',
          pattern: '{}',
        }],
      }, {
        toolName: 'Read',
        // toolInput is undefined — JSON.stringify({}) = '{}'
      });

      expect(result.behavior).toBe('allow');
    });

    it('should use JSON.stringify of toolInput when command is a non-string type', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Bash',
          behavior: 'allow',
          pattern: '{"command":123}',
        }],
      }, {
        toolName: 'Bash',
        toolInput: { command: 123 },
      });

      // command is a number, not string — falls through to JSON.stringify
      expect(result.behavior).toBe('allow');
    });
  });

  // ── readOnly constraint ──────────────────────────────────────────────

  describe('readOnly constraint', () => {
    it('should NOT deny non-write tools when readOnly is set', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Read',
          behavior: 'allow',
          constraints: { readOnly: true },
        }],
      }, {
        toolName: 'Read',
        toolInput: { file_path: '/tmp/test.ts' },
      });

      // Read is not a write-like tool — should be allowed
      expect(result.behavior).toBe('allow');
    });

    it('should deny write tools even with allow behavior when readOnly is set', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Edit',
          behavior: 'allow',
          constraints: { readOnly: true },
        }],
      }, {
        toolName: 'Edit',
        toolInput: { file_path: '/tmp/test.ts' },
      });

      expect(result.behavior).toBe('deny');
      expect(result.reason).toContain('readOnly');
    });

    it('should deny Create (write-like) tool when readOnly is set', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Create',
          behavior: 'allow',
          constraints: { readOnly: true },
        }],
      }, {
        toolName: 'Create',
        toolInput: { path: '/tmp/new.ts' },
      });

      expect(result.behavior).toBe('deny');
    });

    it('should deny Move (write-like) tool when readOnly is set', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Move',
          behavior: 'allow',
          constraints: { readOnly: true },
        }],
      }, {
        toolName: 'Move',
      });

      expect(result.behavior).toBe('deny');
    });
  });

  // ── Path constraints ────────────────────────────────────────────────

  describe('Path constraints', () => {
    it('should allow path that matches allowed prefix', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Edit',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'Edit',
        toolInput: { file_path: '/tmp/project/src/index.ts' },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should allow exact path match (no trailing slash needed)', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Read',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'Read',
        toolInput: { path: '/tmp/project' },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should deny path outside allowed prefixes', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Edit',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'Edit',
        toolInput: { file_path: '/etc/passwd' },
      });

      expect(result.behavior).toBe('deny');
      expect(result.reason).toContain('path constraint');
    });

    it('should check multiple candidate paths from toolInput', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Edit',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'Edit',
        toolInput: {
          path: '/tmp/project/a.ts',
          file_path: '/etc/shadow', // This one is NOT in the allowed paths
        },
      });

      // file_path is outside allowed paths — should deny
      expect(result.behavior).toBe('deny');
    });

    it('should handle paths array from toolInput', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'MultiEdit',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'MultiEdit',
        toolInput: {
          paths: ['/tmp/project/a.ts', '/tmp/project/b.ts'],
        },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should deny when paths array contains an outside path', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'MultiEdit',
          behavior: 'allow',
          constraints: { paths: ['/tmp/project'] },
        }],
      }, {
        toolName: 'MultiEdit',
        toolInput: {
          paths: ['/tmp/project/a.ts', '/etc/passwd'],
        },
      });

      expect(result.behavior).toBe('deny');
    });
  });

  // ── maxFileSize constraint ───────────────────────────────────────────

  describe('maxFileSize constraint', () => {
    it('should allow content within size limit', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Write',
          behavior: 'allow',
          constraints: { maxFileSize: 100 },
        }],
      }, {
        toolName: 'Write',
        toolInput: { path: '/tmp/test.ts', content: 'hello' },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should deny content exceeding size limit', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Write',
          behavior: 'allow',
          constraints: { maxFileSize: 5 },
        }],
      }, {
        toolName: 'Write',
        toolInput: { path: '/tmp/test.ts', content: 'very long content' },
      });

      expect(result.behavior).toBe('deny');
      expect(result.reason).toContain('maxFileSize');
    });

    it('should not check size when content is not a string', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Write',
          behavior: 'allow',
          constraints: { maxFileSize: 5 },
        }],
      }, {
        toolName: 'Write',
        toolInput: { path: '/tmp/test.ts', content: 12345 },
      });

      // content is a number, not string — size is null, no check
      expect(result.behavior).toBe('allow');
    });

    it('should not check size when content is absent', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Write',
          behavior: 'allow',
          constraints: { maxFileSize: 5 },
        }],
      }, {
        toolName: 'Write',
        toolInput: { path: '/tmp/test.ts' },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should allow content exactly at size limit', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Write',
          behavior: 'allow',
          constraints: { maxFileSize: 5 },
        }],
      }, {
        toolName: 'Write',
        toolInput: { path: '/tmp/test.ts', content: 'hello' }, // exactly 5 chars
      });

      expect(result.behavior).toBe('allow');
    });
  });

  // ── Multiple rules / fallthrough ────────────────────────────────────

  describe('Multiple rules and fallthrough', () => {
    it('should skip rules that do not match tool name', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [
          { tool: 'Bash', behavior: 'allow' },
          { tool: 'Read', behavior: 'allow' },
        ],
      }, {
        toolName: 'Edit',
        toolInput: { path: '/tmp/test.ts' },
      });

      // No rule matches Edit — falls through to default
      expect(result.behavior).toBe('deny');
      expect(result.reason).toBe('No matching permission rule');
    });

    it('should match the first rule that matches tool name', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [
          { tool: 'Bash', behavior: 'deny' },
          { tool: 'Bash', behavior: 'allow' },
        ],
      }, {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      });

      // First matching rule wins
      expect(result.behavior).toBe('deny');
    });

    it('should skip rule when pattern does not match', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [
          { tool: 'Bash', behavior: 'deny', pattern: 'rm *' },
          { tool: 'Bash', behavior: 'allow' },
        ],
      }, {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      });

      // First rule pattern doesn't match 'ls' — falls through to second
      expect(result.behavior).toBe('allow');
    });
  });

  // ── "ask" behavior ──────────────────────────────────────────────────

  describe('"ask" behavior passthrough', () => {
    it('should return ask behavior when rule specifies it', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Bash',
          behavior: 'ask',
        }],
      }, {
        toolName: 'Bash',
        toolInput: { command: 'npm install' },
      });

      expect(result.behavior).toBe('ask');
      expect(result.reason).toContain('Matched rule');
    });
  });

  // ── Case-insensitive glob matching ──────────────────────────────────

  describe('Case-insensitive glob matching', () => {
    it('should match case-insensitively', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Bash',
          behavior: 'allow',
          pattern: 'GIT *',
        }],
      }, {
        toolName: 'Bash',
        toolInput: { command: 'git status' },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should match special regex chars in pattern', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Bash',
          behavior: 'allow',
          pattern: 'ls /tmp/test.*',
        }],
      }, {
        toolName: 'Bash',
        toolInput: { command: 'ls /tmp/test.txt' },
      });

      expect(result.behavior).toBe('allow');
    });
  });

  // ── Default behavior ────────────────────────────────────────────────

  describe('Default behavior', () => {
    it('should use "allow" as default behavior', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [],
      }, {
        toolName: 'Unknown',
      });

      expect(result.behavior).toBe('allow');
      expect(result.reason).toBe('No matching permission rule');
    });

    it('should use "ask" as default behavior', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'ask',
        rules: [],
      }, {
        toolName: 'Unknown',
      });

      expect(result.behavior).toBe('ask');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle empty string tool name', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{ tool: 'Bash', behavior: 'allow' }],
      }, {
        toolName: '',
      });

      expect(result.behavior).toBe('deny');
    });

    it('should handle rule with no constraints', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Read',
          behavior: 'allow',
          constraints: {},
        }],
      }, {
        toolName: 'Read',
        toolInput: { file_path: '/any/path' },
      });

      // No active constraints — should allow
      expect(result.behavior).toBe('allow');
    });

    it('should handle path constraint with empty paths array as no constraint', () => {
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Edit',
          behavior: 'allow',
          constraints: { paths: [] },
        }],
      }, {
        toolName: 'Edit',
        toolInput: { file_path: '/etc/passwd' },
      });

      // Empty paths array — the `paths.length > 0` check skips constraint
      expect(result.behavior).toBe('allow');
    });

    it('should extract path from target field in toolInput', () => {
      const allowedPrefix = join(process.cwd(), 'allowed-root');
      const result = evaluatePermissionProfile({
        defaultBehavior: 'deny',
        rules: [{
          tool: 'Delete',
          behavior: 'allow',
          constraints: { paths: [allowedPrefix] },
        }],
      }, {
        toolName: 'Delete',
        toolInput: { target: join(allowedPrefix, 'file.txt') },
      });

      expect(result.behavior).toBe('allow');
    });

    it('should deny when target field path is outside allowed prefixes', () => {
      const allowedPrefix = join(process.cwd(), 'allowed-root');
      const result = evaluatePermissionProfile({
        defaultBehavior: 'allow',
        rules: [{
          tool: 'Delete',
          behavior: 'allow',
          constraints: { paths: [allowedPrefix] },
        }],
      }, {
        toolName: 'Delete',
        toolInput: { target: join(process.cwd(), 'outside.txt') },
      });

      expect(result.behavior).toBe('deny');
    });
  });
});
