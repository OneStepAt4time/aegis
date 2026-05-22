/**
 * validation-trim-whitespace-3956-3957.test.ts
 *
 * Unit tests for the trim + whitespace rejection behavior in validation.ts schemas.
 * Covers: sendMessageSchema, commandSchema, bashSchema.
 *
 * References:
 *   #3990 — Missing test coverage for input validation (this file).
 *   #3956 — Session name whitespace-only rejected.
 *   #3957 — Prompt whitespace-only rejected (server hang).
 *   PR #3964 — Added preprocess trim to reject whitespace-only inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  sendMessageSchema,
  commandSchema,
  bashSchema,
} from '../validation.js';

// ── sendMessageSchema ────────────────────────────────────────────

describe('sendMessageSchema — trim and whitespace rejection (#3957)', () => {
  it('trims leading/trailing whitespace from text', () => {
    const result = sendMessageSchema.safeParse({ text: '  hello world  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('hello world');
    }
  });

  it('rejects whitespace-only text (spaces)', () => {
    const result = sendMessageSchema.safeParse({ text: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only text (tabs)', () => {
    const result = sendMessageSchema.safeParse({ text: '\t\t' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only text (newlines)', () => {
    const result = sendMessageSchema.safeParse({ text: '\n\n' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only text (mixed whitespace)', () => {
    const result = sendMessageSchema.safeParse({ text: '  \t \n  ' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = sendMessageSchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid non-whitespace text', () => {
    const result = sendMessageSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('hello');
    }
  });

  it('preserves internal whitespace while trimming edges', () => {
    const result = sendMessageSchema.safeParse({ text: '  hello   world  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('hello   world');
    }
  });

  it('rejects text exceeding MAX_INPUT_LENGTH after trim', () => {
    const longText = 'a'.repeat(10_001);
    const result = sendMessageSchema.safeParse({ text: longText });
    expect(result.success).toBe(false);
  });

  it('accepts text at exactly MAX_INPUT_LENGTH', () => {
    const exactText = 'a'.repeat(10_000);
    const result = sendMessageSchema.safeParse({ text: exactText });
    expect(result.success).toBe(true);
  });

  it('passes through non-string values unchanged (preprocess guard)', () => {
    // z.preprocess only trims strings; non-strings fall through to z.string()
    // which should then fail validation
    const result = sendMessageSchema.safeParse({ text: 123 });
    expect(result.success).toBe(false);
  });
});

// ── commandSchema ────────────────────────────────────────────────

describe('commandSchema — trim and whitespace rejection (#3957)', () => {
  it('trims leading/trailing whitespace from command', () => {
    const result = commandSchema.safeParse({ command: '  ls -la  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('ls -la');
    }
  });

  it('rejects whitespace-only command (spaces)', () => {
    const result = commandSchema.safeParse({ command: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only command (tabs)', () => {
    const result = commandSchema.safeParse({ command: '\t\t' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only command (newlines)', () => {
    const result = commandSchema.safeParse({ command: '\n\n' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only command (mixed)', () => {
    const result = commandSchema.safeParse({ command: ' \t \n ' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = commandSchema.safeParse({ command: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid command', () => {
    const result = commandSchema.safeParse({ command: 'npm test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('npm test');
    }
  });
});

// ── bashSchema ───────────────────────────────────────────────────

describe('bashSchema — trim and whitespace rejection (#3957)', () => {
  it('trims leading/trailing whitespace from bash command', () => {
    const result = bashSchema.safeParse({ command: '  echo hello  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('echo hello');
    }
  });

  it('rejects whitespace-only bash command (spaces)', () => {
    const result = bashSchema.safeParse({ command: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only bash command (tabs)', () => {
    const result = bashSchema.safeParse({ command: '\t\t' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only bash command (newlines)', () => {
    const result = bashSchema.safeParse({ command: '\n\n' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only bash command (mixed)', () => {
    const result = bashSchema.safeParse({ command: ' \n \t ' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = bashSchema.safeParse({ command: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid bash command', () => {
    const result = bashSchema.safeParse({ command: 'git status' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('git status');
    }
  });
});
