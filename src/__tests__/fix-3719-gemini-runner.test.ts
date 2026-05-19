/**
 * Issue #3719 — Gemini runner stub coverage improvement
 *
 * Covers uncovered methods: sendInput, readOutput, kill.
 * Existing coverage in fix-3263 covers: name, isAlive, getHandle, start.
 */
import { describe, it, expect } from 'vitest';
import { GeminiCliRunner } from '../runners/stubs/gemini-runner.js';

describe('Issue #3719 — GeminiCliRunner stub (full coverage)', () => {
  const runner = new GeminiCliRunner();

  it('throws NotImplementedError on sendInput', async () => {
    await expect(runner.sendInput('handle', 'hello')).rejects.toThrow('not implemented');
  });

  it('throws NotImplementedError on readOutput', async () => {
    // The throw happens before any yield, so iterating triggers it
    const gen = runner.readOutput('handle');
    await expect((async () => {
      for await (const _ of gen) { break; }
    })()).rejects.toThrow('not implemented');
  });

  it('throws NotImplementedError on kill', async () => {
    await expect(runner.kill('handle')).rejects.toThrow('not implemented');
  });

  it('kill accepts options without error (still throws NotImplementedError)', async () => {
    await expect(
      runner.kill('handle', { force: true }),
    ).rejects.toThrow('not implemented');
  });

  it('isAlive returns false for any handle', () => {
    expect(runner.isAlive('any-handle')).toBe(false);
    expect(runner.isAlive('')).toBe(false);
  });

  it('getHandle returns undefined for any sessionId', () => {
    expect(runner.getHandle('any-session')).toBeUndefined();
    expect(runner.getHandle('')).toBeUndefined();
  });

  it('name is gemini-cli', () => {
    expect(runner.name).toBe('gemini-cli');
  });

  it('start throws NotImplementedError', async () => {
    await expect(runner.start('s1', { cwd: '/tmp' })).rejects.toThrow('not implemented');
  });
});
