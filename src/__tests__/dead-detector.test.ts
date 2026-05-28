/**
 * Tests for monitor/dead-detector.ts — Dead session detection and cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeadDetector } from '../monitor/dead-detector.js';
import type { DeadDetectorDeps } from '../monitor/dead-detector.js';

function makeDeps(): DeadDetectorDeps {
  return {
    sessions: {
      listSessions: vi.fn(() => []),
      isWindowAlive: vi.fn(async () => true),
      approve: vi.fn(),
      killSession: vi.fn(async () => {}),
    } as any,
    makePayload: vi.fn((event, session, detail) => ({ event, session: { id: session.id }, detail })),
    emitDead: vi.fn(),
    alertFailure: vi.fn(),
    statusChange: vi.fn(),
    removeSession: vi.fn(),
  };
}

function makeSession(id = 's1', overrides: Record<string, any> = {}) {
  return {
    id,
    displayName: `Session ${id}`,
    windowId: `w-${id}`,
    claudeSessionId: `cs-${id}`,
    ccPid: 1234,
    createdAt: Date.now() - 60000,
    lastActivity: new Date().toISOString(),
    ...overrides,
  } as any;
}

describe('DeadDetector', () => {
  let deps: DeadDetectorDeps;
  let detector: DeadDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    detector = new DeadDetector(deps);
  });

  describe('getDeadNotified', () => {
    it('starts with empty set', () => {
      expect(detector.getDeadNotified()).toEqual(new Set());
    });
  });

  describe('updateDeps', () => {
    it('replaces dependency callbacks', () => {
      const newEmitDead = vi.fn();
      detector.updateDeps({ emitDead: newEmitDead });
      // Verify by triggering dead detection
      const session = makeSession();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(false);

      return detector.checkDeadSessions().then(() => {
        expect(newEmitDead).toHaveBeenCalledWith('s1', expect.any(String));
      });
    });
  });

  describe('checkDeadSessions', () => {
    it('does nothing when no sessions exist', async () => {
      (deps.sessions.listSessions as any).mockReturnValue([]);
      await detector.checkDeadSessions();
      expect(deps.statusChange).not.toHaveBeenCalled();
    });

    it('skips sessions already in deadNotified', async () => {
      const session = makeSession();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(false);

      // First detection
      await detector.checkDeadSessions();
      expect(deps.statusChange).toHaveBeenCalledTimes(1);

      // Second run — should skip
      vi.clearAllMocks();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      await detector.checkDeadSessions();
      expect(deps.statusChange).not.toHaveBeenCalled();
    });

    it('detects dead session and notifies', async () => {
      const session = makeSession('s1');
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(false);

      await detector.checkDeadSessions();

      expect(detector.getDeadNotified().has('s1')).toBe(true);
      expect(deps.emitDead).toHaveBeenCalledWith('s1', expect.stringContaining('died'));
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.dead' }),
      );
      expect(deps.alertFailure).toHaveBeenCalledWith('session_failure', expect.any(String));
      expect(deps.removeSession).toHaveBeenCalledWith('s1');
      expect(deps.sessions.killSession).toHaveBeenCalledWith('s1');
    });

    it('skips alive sessions', async () => {
      const session = makeSession();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(true);

      await detector.checkDeadSessions();

      expect(detector.getDeadNotified().has('s1')).toBe(false);
      expect(deps.statusChange).not.toHaveBeenCalled();
    });

    it('works without optional callbacks (emitDead, alertFailure)', async () => {
      delete deps.emitDead;
      delete deps.alertFailure;
      const session = makeSession();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(false);

      await detector.checkDeadSessions();

      expect(deps.statusChange).toHaveBeenCalled();
      expect(deps.removeSession).toHaveBeenCalledWith('s1');
    });
  });

  describe('removeSession', () => {
    it('removes session from deadNotified set', async () => {
      const session = makeSession();
      (deps.sessions.listSessions as any).mockReturnValue([session]);
      (deps.sessions.isWindowAlive as any).mockResolvedValue(false);

      await detector.checkDeadSessions();
      expect(detector.getDeadNotified().has('s1')).toBe(true);

      detector.removeSession('s1');
      expect(detector.getDeadNotified().has('s1')).toBe(false);
    });
  });
});
