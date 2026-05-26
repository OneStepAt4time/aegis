import { describe, it, expect, vi } from 'vitest';
import { SessionPersistenceService } from '../services/session/persistence.js';
import { SessionEncryptionService } from '../services/session/encryption.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

vi.mock('../logger.js', () => ({
  StructuredLogger: vi.fn().mockImplementation(function (this: any) {
    this.info = vi.fn();
    this.warn = vi.fn();
    this.error = vi.fn();
    this.debug = vi.fn();
  }),
}));

describe('SessionPersistenceService', () => {
  it('is constructible with stateFile, store, and encryption service', () => {
    const enc = new SessionEncryptionService();
    const svc = new SessionPersistenceService('/tmp/state.json', null, enc);
    expect(typeof svc.load).toBe('function');
    expect(typeof svc.flush).toBe('function');
    expect(typeof svc.writeBackup).toBe('function');
    expect(typeof svc.serializeState).toBe('function');
  });

  it('load() returns empty sessions when no state file exists', async () => {
    const enc = new SessionEncryptionService();
    const svc = new SessionPersistenceService('/tmp/state.json', null, enc);
    const state = await svc.load();
    expect(Object.keys(state.sessions)).toHaveLength(0);
  });

  it('serializeState() serializes empty state to JSON', () => {
    const enc = new SessionEncryptionService();
    const svc = new SessionPersistenceService('/tmp/state.json', null, enc);
    const json = svc.serializeState({ sessions: Object.create(null) });
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('sessions');
  });
});
