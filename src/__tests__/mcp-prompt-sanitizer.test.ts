/**
 * Unit tests for src/mcp/prompt-sanitizer.ts
 *
 * Covers all validators: validateIssueOrPrNumber, validateSessionId,
 * validateRepoField, validateWorkDir — plus the shared security checks
 * (hostile markers, control characters, bidi, fences, tool names).
 */
import { describe, expect, it } from 'vitest';
import {
  validateIssueOrPrNumber,
  validateSessionId,
  validateRepoField,
  validateWorkDir,
  PromptInputError,
  MAX_ISSUE_NUMBER_LEN,
  MAX_REPO_FIELD_LEN,
  MAX_WORK_DIR_LEN,
} from '../mcp/prompt-sanitizer.js';

// ── PromptInputError ──────────────────────────────────────────────────

describe('PromptInputError', () => {
  it('exposes field and reason', () => {
    const err = new PromptInputError('testField', 'bad value');
    expect(err.field).toBe('testField');
    expect(err.reason).toBe('bad value');
    expect(err.message).toContain('testField');
    expect(err.message).toContain('bad value');
    expect(err.name).toBe('PromptInputError');
  });

  it('is an instance of Error', () => {
    expect(new PromptInputError('x', 'y')).toBeInstanceOf(Error);
  });
});

// ── validateIssueOrPrNumber ────────────────────────────────────────────

describe('validateIssueOrPrNumber', () => {
  it('accepts valid issue numbers', () => {
    expect(validateIssueOrPrNumber('issue', '1')).toBe('1');
    expect(validateIssueOrPrNumber('issue', '123')).toBe('123');
    expect(validateIssueOrPrNumber('issue', '9999999')).toBe('9999999');
  });

  it('rejects empty string', () => {
    expect(() => validateIssueOrPrNumber('f', '')).toThrow(PromptInputError);
  });

  it('rejects zero-padded numbers', () => {
    expect(() => validateIssueOrPrNumber('f', '01')).toThrow(PromptInputError);
  });

  it('rejects zero', () => {
    expect(() => validateIssueOrPrNumber('f', '0')).toThrow(PromptInputError);
  });

  it('rejects negative numbers', () => {
    expect(() => validateIssueOrPrNumber('f', '-1')).toThrow(PromptInputError);
  });

  it('rejects non-numeric input', () => {
    expect(() => validateIssueOrPrNumber('f', 'abc')).toThrow(PromptInputError);
    expect(() => validateIssueOrPrNumber('f', '12a')).toThrow(PromptInputError);
  });

  it('rejects input exceeding max length', () => {
    const tooLong = '1'.repeat(MAX_ISSUE_NUMBER_LEN + 1);
    expect(() => validateIssueOrPrNumber('f', tooLong)).toThrow(PromptInputError);
  });

  it('accepts input at exactly max length', () => {
    const atLimit = '1'.repeat(MAX_ISSUE_NUMBER_LEN);
    expect(validateIssueOrPrNumber('f', atLimit)).toBe(atLimit);
  });
});

// ── validateSessionId ──────────────────────────────────────────────────

describe('validateSessionId', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts a valid UUID', () => {
    expect(validateSessionId(validUuid)).toBe(validUuid);
  });

  it('accepts uppercase UUID', () => {
    const upper = validUuid.toUpperCase();
    expect(validateSessionId(upper)).toBe(upper);
  });

  it('rejects empty string', () => {
    expect(() => validateSessionId('')).toThrow(PromptInputError);
  });

  it('rejects non-UUID strings', () => {
    expect(() => validateSessionId('not-a-uuid')).toThrow(PromptInputError);
    expect(() => validateSessionId('12345')).toThrow(PromptInputError);
  });

  it('rejects UUID with extra characters', () => {
    expect(() => validateSessionId(validUuid + 'x')).toThrow(PromptInputError);
  });

  // ── Control characters ────────────────────────────────────────────

  it('rejects null bytes', () => {
    expect(() => validateSessionId('550e8400-\0e29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  it('rejects newline in UUID', () => {
    expect(() => validateSessionId('550e8400-\ne29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  it('rejects tab character', () => {
    expect(() => validateSessionId('550e8400\te29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  // ── Bidi / zero-width ─────────────────────────────────────────────

  it('rejects bidi override characters', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE
    expect(() => validateSessionId('\u202E' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects zero-width space', () => {
    // U+200B ZERO-WIDTH SPACE
    expect(() => validateSessionId('550e8400\u200B-e29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  it('rejects zero-width joiner', () => {
    // U+200D ZERO-WIDTH JOINER
    expect(() => validateSessionId('550e8400\u200D-e29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  it('rejects BOM', () => {
    // U+FEFF ZERO-WIDTH NO-BREAK SPACE
    expect(() => validateSessionId('\uFEFF' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects line separator', () => {
    // U+2028 LINE SEPARATOR
    expect(() => validateSessionId('550e8400\u2028e29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  // ── Fence markers ──────────────────────────────────────────────────

  it('rejects triple backtick fence', () => {
    expect(() => validateSessionId('```' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects triple tilde fence', () => {
    expect(() => validateSessionId('~~~' + validUuid)).toThrow(PromptInputError);
  });

  // ── Tool invocation markers ────────────────────────────────────────

  it('rejects tool_use XML marker', () => {
    expect(() => validateSessionId('<tool_use>' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects function_calls XML marker', () => {
    expect(() => validateSessionId('<function_calls>' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects tool_result JSON marker', () => {
    expect(() => validateSessionId('"type": "tool_result"' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects MCP tool name (kill_session)', () => {
    expect(() => validateSessionId('kill_session' + validUuid)).toThrow(PromptInputError);
  });

  it('rejects MCP tool name (create_session)', () => {
    expect(() => validateSessionId('create_session' + validUuid)).toThrow(PromptInputError);
  });
});

// ── validateRepoField ──────────────────────────────────────────────────

describe('validateRepoField', () => {
  it('accepts valid GitHub owner/repo names', () => {
    expect(validateRepoField('owner', 'onestepat4time')).toBe('onestepat4time');
    expect(validateRepoField('repo', 'aegis')).toBe('aegis');
    expect(validateRepoField('owner', 'My-Org')).toBe('My-Org');
    expect(validateRepoField('repo', 'my.repo')).toBe('my.repo');
    expect(validateRepoField('owner', 'org_name')).toBe('org_name');
    expect(validateRepoField('owner', 'A1B2')).toBe('A1B2');
  });

  it('rejects empty string', () => {
    expect(() => validateRepoField('f', '')).toThrow(PromptInputError);
  });

  it('rejects names starting with dot', () => {
    expect(() => validateRepoField('f', '.hidden')).toThrow(PromptInputError);
  });

  it('rejects names starting with dash', () => {
    expect(() => validateRepoField('f', '-dash')).toThrow(PromptInputError);
  });

  it('rejects names ending with dot', () => {
    expect(() => validateRepoField('f', 'name.')).toThrow(PromptInputError);
  });

  it('rejects names ending with dash', () => {
    expect(() => validateRepoField('f', 'name-')).toThrow(PromptInputError);
  });

  it('rejects names with spaces', () => {
    expect(() => validateRepoField('f', 'has space')).toThrow(PromptInputError);
  });

  it('rejects names with special characters', () => {
    expect(() => validateRepoField('f', 'na@me')).toThrow(PromptInputError);
    expect(() => validateRepoField('f', 'na/me')).toThrow(PromptInputError);
    expect(() => validateRepoField('f', 'na\\me')).toThrow(PromptInputError);
  });

  it('rejects names exceeding max length', () => {
    const tooLong = 'a'.repeat(MAX_REPO_FIELD_LEN + 1);
    expect(() => validateRepoField('f', tooLong)).toThrow(PromptInputError);
  });

  it('accepts names at exactly max length', () => {
    const atLimit = 'a'.repeat(MAX_REPO_FIELD_LEN);
    expect(validateRepoField('f', atLimit)).toBe(atLimit);
  });

  // ── Hostile markers ────────────────────────────────────────────────

  it('rejects control characters', () => {
    expect(() => validateRepoField('f', 'own\x00er')).toThrow(PromptInputError);
  });

  it('rejects fence markers', () => {
    expect(() => validateRepoField('f', '```repo```')).toThrow(PromptInputError);
  });

  it('rejects tool invocation markers', () => {
    expect(() => validateRepoField('f', '<tool_use>repo')).toThrow(PromptInputError);
  });

  it('rejects bidi overrides', () => {
    expect(() => validateRepoField('f', 'repo\u202Ename')).toThrow(PromptInputError);
  });
});

// ── validateWorkDir ────────────────────────────────────────────────────

describe('validateWorkDir', () => {
  it('accepts valid Unix absolute paths', () => {
    expect(validateWorkDir('/home/user/project')).toBe('/home/user/project');
    expect(validateWorkDir('/tmp')).toBe('/tmp');
    expect(validateWorkDir('/a/b/c/d/e')).toBe('/a/b/c/d/e');
  });

  it('accepts valid relative paths', () => {
    expect(validateWorkDir('./project')).toBe('./project');
    expect(validateWorkDir('project')).toBe('project');
  });

  it('accepts paths with underscores and dots (non-traversal)', () => {
    expect(validateWorkDir('/home/my_project')).toBe('/home/my_project');
    expect(validateWorkDir('/home/project.v2')).toBe('/home/project.v2');
  });

  it('rejects empty string', () => {
    expect(() => validateWorkDir('')).toThrow(PromptInputError);
  });

  it('rejects path traversal (..)', () => {
    expect(() => validateWorkDir('/home/../etc')).toThrow(PromptInputError);
    expect(() => validateWorkDir('/home/user/../../etc')).toThrow(PromptInputError);
    expect(() => validateWorkDir('../secret')).toThrow(PromptInputError);
  });

  it('rejects paths exceeding max length', () => {
    const tooLong = '/' + 'a'.repeat(MAX_WORK_DIR_LEN);
    expect(() => validateWorkDir(tooLong)).toThrow(PromptInputError);
  });

  it('accepts paths at exactly max length', () => {
    // /home/... = 6 chars prefix + rest
    const path = '/home/' + 'a'.repeat(MAX_WORK_DIR_LEN - 6);
    expect(validateWorkDir(path)).toBe(path);
  });

  // ── Hostile markers ────────────────────────────────────────────────

  it('rejects control characters', () => {
    expect(() => validateWorkDir('/home/\x00user')).toThrow(PromptInputError);
  });

  it('rejects newlines', () => {
    expect(() => validateWorkDir('/home/\nuser')).toThrow(PromptInputError);
  });

  it('rejects carriage returns', () => {
    expect(() => validateWorkDir('/home/\ruser')).toThrow(PromptInputError);
  });

  it('rejects fence markers', () => {
    expect(() => validateWorkDir('/home/```project')).toThrow(PromptInputError);
  });

  it('rejects tool invocation markers', () => {
    expect(() => validateWorkDir('/home/<tool_use>project')).toThrow(PromptInputError);
  });

  it('rejects tool_result JSON marker', () => {
    expect(() => validateWorkDir('/home/"type": "tool_result"')).toThrow(PromptInputError);
  });

  it('rejects bidi overrides', () => {
    expect(() => validateWorkDir('/home/\u202Eproject')).toThrow(PromptInputError);
  });

  it('rejects zero-width characters', () => {
    expect(() => validateWorkDir('/home/\u200Bproject')).toThrow(PromptInputError);
  });

  it('rejects BOM', () => {
    expect(() => validateWorkDir('\uFEFF/home/project')).toThrow(PromptInputError);
  });

  it('rejects MCP tool names in path', () => {
    expect(() => validateWorkDir('/home/kill_session')).toThrow(PromptInputError);
    expect(() => validateWorkDir('/home/create_session')).toThrow(PromptInputError);
  });
});

// ── Round-trip: safe content is never altered ──────────────────────────

describe('round-trip: safe content preserved', () => {
  it('preserves safe issue numbers', () => {
    const safe = '42';
    expect(validateIssueOrPrNumber('f', safe)).toBe(safe);
  });

  it('preserves safe UUIDs', () => {
    const safe = '550e8400-e29b-41d4-a716-446655440000';
    expect(validateSessionId(safe)).toBe(safe);
  });

  it('preserves safe repo names', () => {
    const safe = 'OneStepAt4time';
    expect(validateRepoField('owner', safe)).toBe(safe);
  });

  it('preserves safe workDir paths', () => {
    const safe = '/home/bubuntu/projects/aegis';
    expect(validateWorkDir(safe)).toBe(safe);
  });

  it('preserves paths with hyphens and dots (non-traversal)', () => {
    const safe = '/home/my-project.v2/src';
    expect(validateWorkDir(safe)).toBe(safe);
  });
});

// ── Boundary: very long inputs ─────────────────────────────────────────

describe('boundary: oversized inputs', () => {
  it('rejects issue number at 11 digits', () => {
    expect(() => validateIssueOrPrNumber('f', '12345678901')).toThrow(PromptInputError);
  });

  it('rejects repo field at 101 chars', () => {
    expect(() => validateRepoField('f', 'a'.repeat(101))).toThrow(PromptInputError);
  });

  it('rejects workDir at 1025 chars', () => {
    expect(() => validateWorkDir('/' + 'a'.repeat(1024))).toThrow(PromptInputError);
  });
});

// ── Injection pattern coverage ─────────────────────────────────────────

describe('injection patterns', () => {
  it('rejects system prompt leak attempt via tool_use', () => {
    expect(() => validateWorkDir('/home/<tool_use>ignore_previous')).toThrow(PromptInputError);
  });

  it('rejects closing tool_use tag', () => {
    expect(() => validateWorkDir('/home/</tool_use>')).toThrow(PromptInputError);
  });

  it('rejects invoke marker', () => {
    expect(() => validateRepoField('f', '<invoke>evil')).toThrow(PromptInputError);
  });

  it('rejects tool_use JSON format', () => {
    expect(() => validateRepoField('f', '"type": "tool_use"')).toThrow(PromptInputError);
  });

  it('rejects whitespace-tolerant tool_use match', () => {
    expect(() => validateWorkDir('/home/< tool_use >')).toThrow(PromptInputError);
  });

  it('rejects case-insensitive tool markers', () => {
    expect(() => validateWorkDir('/home/<TOOL_USE>')).toThrow(PromptInputError);
    expect(() => validateWorkDir('/home/<Tool_Result>')).toThrow(PromptInputError);
  });

  it('rejects all MCP tool names as substrings', () => {
    const toolNames = [
      'list_sessions', 'get_status', 'get_transcript', 'send_message',
      'create_session', 'kill_session', 'approve_permission',
      'reject_permission', 'server_health', 'escape_session',
      'interrupt_session', 'get_session_metrics', 'get_session_summary',
      'send_command', 'get_session_latency', 'batch_create_sessions',
      'list_pipelines', 'create_pipeline', 'get_swarm', 'state_set',
      'state_get', 'state_delete',
    ];
    for (const name of toolNames) {
      expect(() => validateWorkDir(`/home/${name}`), `should reject '${name}'`).toThrow(PromptInputError);
    }
  });
});

// ── Unicode edge cases ─────────────────────────────────────────────────

describe('unicode edge cases', () => {
  it('rejects paragraph separator', () => {
    // U+2029 PARAGRAPH SEPARATOR
    expect(() => validateSessionId('\u2029' + '550e8400-e29b-41d4-a716-446655440000')).toThrow(PromptInputError);
  });

  it('rejects bidi isolate start', () => {
    // U+2066 LEFT-TO-RIGHT ISOLATE
    expect(() => validateRepoField('f', 'repo\u2066name')).toThrow(PromptInputError);
  });

  it('rejects bidi pop directional isolate', () => {
    // U+2069 POP DIRECTIONAL ISOLATE
    expect(() => validateRepoField('f', 'repo\u2069name')).toThrow(PromptInputError);
  });

  it('rejects zero-width non-joiner', () => {
    // U+200C ZERO-WIDTH NON-JOINER (not in FORBIDDEN_CHAR_RE but the range 200B-200D covers it)
    expect(() => validateRepoField('f', 'repo\u200Cname')).toThrow(PromptInputError);
  });

  it('accepts regular unicode in workDir (CJK path segments)', () => {
    // CJK characters are not forbidden — only control chars and bidi are
    expect(validateWorkDir('/home/用户/项目')).toBe('/home/用户/项目');
  });

  it('accepts emoji in workDir', () => {
    expect(validateWorkDir('/home/🚀project')).toBe('/home/🚀project');
  });
});
