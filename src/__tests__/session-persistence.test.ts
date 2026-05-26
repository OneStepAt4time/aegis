import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SessionPersistenceService,
  cleanTmpFiles,
  isValidState,
} from '../services/session/persistence.js';
import type { SessionInfo } from '../session.js';

const cleanup: string[] = [];

afterEach(() => {
  for (const d of cleanup.splice(0)) {
    try { rmSync(d, { recursive: true }); } catch { /* ok */ }
  }
});

function makeService(stateFile: string) {
  mkdirSync(join(stateFile, '..'), { recursive: true });
  return new SessionPersistenceService(stateFile, null);
}

describe('isValidState', () => {
  it('rejects null', () => expect(isValidState(null)).toBe(false));
  it('rejects non-object', () => expect(isValidState('x')).toBe(false));
  it('rejects missing sessions', () => expect(isValidState({})).toBe(false));
  it('accepts valid session state', () => {
    expect(isValidState({ sessions: { s1: { id: 's1', displayName: 'S1' } } })).toBe(true);
  });
  it('rejects session with missing id', () => {
    expect(isValidState({ sessions: { s1: { displayName: 'S1' } } })).toBe(false);
  });
});

describe('cleanTmpFiles', () => {
  it('removes stale .tmp files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
    cleanup.push(dir);
    writeFileSync(join(dir, 'stale.tmp'), 'stale');
    writeFileSync(join(dir, 'keep.json'), '{}');
    cleanTmpFiles(dir);
    expect(readFileSync(join(dir, 'keep.json'), 'utf-8')).toBe('{}');
    expect(existsSync(join(dir, 'stale.tmp'))).toBe(false);
  });
});

describe('SessionPersistenceService', () => {
  it('loads empty state when no file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
    cleanup.push(dir);
    const svc = makeService(join(dir, 'state.json'));
    const state = await svc.load();
    expect(Object.keys(state.sessions).length).toBe(0);
  });

  it('creates state dir if missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
    cleanup.push(dir);
    const nested = join(dir, 'sub', 'dir', 'state.json');
    const svc = new SessionPersistenceService(nested, null);
    const state = await svc.load();
    expect(Object.keys(state.sessions).length).toBe(0);
  });

  it('cancelDebouncedSave does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
    cleanup.push(dir);
    const svc = makeService(join(dir, 'state.json'));
    svc.debouncedSave({ sessions: {} as Record<string, SessionInfo> });
    svc.cancelDebouncedSave();
    expect(true).toBe(true);
  });
});
