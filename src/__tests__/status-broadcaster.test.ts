/**
 * Tests for monitor/status-broadcaster.ts — Status change detection and broadcasting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBroadcaster } from '../monitor/status-broadcaster.js';
import type { StatusBroadcasterDeps } from '../monitor/status-broadcaster.js';

function makeDeps(): StatusBroadcasterDeps {
  return {
    sessions: {
      approve: vi.fn(async () => {}),
    } as any,
    makePayload: ((event: any, session: any, detail: any) => ({ event, session: { id: session.id }, detail })) as StatusBroadcasterDeps['makePayload'],
    statusChange: vi.fn(),
    emitApproval: vi.fn(),
    emitStatus: vi.fn(),
  };
}

function makeSession(id = 's1', permissionMode = 'default') {
  return {
    id,
    displayName: `Session ${id}`,
    workDir: '/tmp/test',
    permissionMode,
    status: 'working',
  } as any;
}

describe('StatusBroadcaster', () => {
  let deps: StatusBroadcasterDeps;
  let broadcaster: StatusBroadcaster;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    broadcaster = new StatusBroadcaster(deps);
  });

  describe('getters', () => {
    it('getIdleNotified starts empty', () => {
      expect(broadcaster.getIdleNotified()).toEqual(new Set());
    });

    it('getIdleSince starts empty', () => {
      expect(broadcaster.getIdleSince()).toEqual(new Map());
    });

    it('getDebounceMap starts empty', () => {
      expect(broadcaster.getDebounceMap()).toEqual(new Map());
    });
  });

  describe('updateDeps', () => {
    it('replaces dependency callbacks', () => {
      const newEmitApproval = vi.fn();
      broadcaster.updateDeps({ emitApproval: newEmitApproval });
      // Verify by triggering a permission status
      const session = makeSession();
      return broadcaster.broadcastStatusChange(session, 'permission_prompt' as any, undefined, {
        statusText: null,
        interactiveContent: 'test permission',
      }).then(() => {
        expect(newEmitApproval).toHaveBeenCalledWith('s1', 'test permission');
      });
    });
  });

  describe('broadcastStatusChange', () => {
    it('handles permission_prompt — emits approval and status change', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'permission_prompt' as any, undefined, {
        statusText: null,
        interactiveContent: 'Allow file write?',
      });

      expect(deps.emitApproval).toHaveBeenCalledWith('s1', 'Allow file write?');
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.permission' }),
      );
    });

    it('auto-approves for non-default permission modes', async () => {
      const session = makeSession('s1', 'auto');
      await broadcaster.broadcastStatusChange(session, 'permission_prompt' as any, undefined, {
        statusText: null,
        interactiveContent: 'Allow file write?',
      });

      expect(deps.sessions.approve).toHaveBeenCalledWith('s1');
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.stringContaining('AUTO-APPROVED'),
        }),
      );
    });

    it('handles auto-approve failure gracefully', async () => {
      (deps.sessions.approve as any).mockRejectedValue(new Error('approve failed'));
      const session = makeSession('s1', 'auto');

      await broadcaster.broadcastStatusChange(session, 'permission_prompt' as any, undefined, {
        statusText: null,
        interactiveContent: 'Allow file write?',
      });

      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.stringContaining('AUTO-APPROVE FAILED'),
        }),
      );
    });

    it('handles plan_mode status', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'plan_mode' as any, undefined, {
        statusText: null,
        interactiveContent: 'Review my plan',
      });

      expect(deps.emitStatus).toHaveBeenCalledWith('s1', 'plan_mode', 'Review my plan');
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.plan' }),
      );
    });

    it('handles idle status with debounce — no notification if idle < 3s', async () => {
      const session = makeSession();
      broadcaster.recordStatus('s1', 'idle' as any);

      await broadcaster.broadcastStatusChange(session, 'idle' as any, 'working' as any, {
        statusText: 'Done working',
        interactiveContent: null,
      });

      // idleSince was just set, idleDuration is ~0ms, so no notification
      expect(deps.statusChange).not.toHaveBeenCalled();
    });

    it('handles idle status — notifies after 3s idle duration', async () => {
      const session = makeSession();
      // Manually set idleSince to 4 seconds ago
      broadcaster.getIdleSince().set('s1', Date.now() - 4000);

      await broadcaster.broadcastStatusChange(session, 'idle' as any, 'working' as any, {
        statusText: 'Done working',
        interactiveContent: null,
      });

      expect(broadcaster.getIdleNotified().has('s1')).toBe(true);
      expect(deps.emitStatus).toHaveBeenCalledWith('s1', 'idle', 'Done working');
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.idle' }),
      );
    });

    it('deduplicates idle notifications', async () => {
      const session = makeSession();
      broadcaster.getIdleSince().set('s1', Date.now() - 4000);

      // First notification
      await broadcaster.broadcastStatusChange(session, 'idle' as any, 'working' as any, {
        statusText: 'Done',
        interactiveContent: null,
      });
      expect(deps.statusChange).toHaveBeenCalledTimes(1);

      // Second notification — should be deduplicated
      await broadcaster.broadcastStatusChange(session, 'idle' as any, 'idle' as any, {
        statusText: 'Still done',
        interactiveContent: null,
      });
      expect(deps.statusChange).toHaveBeenCalledTimes(1);
    });

    it('handles context_warning — auto-compact once', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'context_warning' as any, 'working' as any, {
        statusText: 'warning',
        interactiveContent: null,
      });

      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.context_warning' }),
      );
    });

    it('deduplicates context_warning notifications', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'context_warning' as any, 'working' as any, {
        statusText: 'warning',
        interactiveContent: null,
      });
      expect(deps.statusChange).toHaveBeenCalledTimes(1);

      // Second context_warning with same prevStatus → skipped
      await broadcaster.broadcastStatusChange(session, 'context_warning' as any, 'context_warning' as any, {
        statusText: 'warning',
        interactiveContent: null,
      });
      // Still only 1 (prevStatus check prevents entry)
      expect(deps.statusChange).toHaveBeenCalledTimes(1);
    });

    it('handles ask_question status', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'ask_question' as any, undefined, {
        statusText: null,
        interactiveContent: 'What framework?',
      });

      expect(deps.emitStatus).toHaveBeenCalledWith('s1', 'ask_question', 'What framework?');
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.question' }),
      );
    });

    it('emits working status when transitioning to working', async () => {
      const session = makeSession();
      await broadcaster.broadcastStatusChange(session, 'working' as any, 'idle' as any, {
        statusText: null,
        interactiveContent: null,
      });

      expect(deps.emitStatus).toHaveBeenCalledWith('s1', 'working', 'Claude is working');
    });
  });

  describe('recordStatus', () => {
    it('sets idleSince on idle status', () => {
      broadcaster.recordStatus('s1', 'idle' as any);
      expect(broadcaster.getIdleSince().has('s1')).toBe(true);
    });

    it('does not overwrite existing idleSince', () => {
      const original = Date.now() - 5000;
      broadcaster.getIdleSince().set('s1', original);
      broadcaster.recordStatus('s1', 'idle' as any);
      expect(broadcaster.getIdleSince().get('s1')).toBe(original);
    });

    it('clears idle tracking on non-idle status', () => {
      broadcaster.getIdleSince().set('s1', Date.now());
      broadcaster.getIdleNotified().add('s1');
      broadcaster.recordStatus('s1', 'working' as any);
      expect(broadcaster.getIdleSince().has('s1')).toBe(false);
      expect(broadcaster.getIdleNotified().has('s1')).toBe(false);
    });
  });

  describe('removeSession', () => {
    it('clears all tracking for a session', () => {
      broadcaster.getIdleNotified().add('s1');
      broadcaster.getIdleSince().set('s1', Date.now());
      const timer = setTimeout(() => {}, 10000);
      broadcaster.getDebounceMap().set('s1', timer);

      broadcaster.removeSession('s1');

      expect(broadcaster.getIdleNotified().has('s1')).toBe(false);
      expect(broadcaster.getIdleSince().has('s1')).toBe(false);
      expect(broadcaster.getDebounceMap().has('s1')).toBe(false);
      clearTimeout(timer);
    });
  });

  describe('clearContextWarningCompact', () => {
    it('allows context_warning to fire again after clear', async () => {
      const session = makeSession();

      // First context warning
      await broadcaster.broadcastStatusChange(session, 'context_warning' as any, 'working' as any, {
        statusText: 'warning',
        interactiveContent: null,
      });
      expect(deps.statusChange).toHaveBeenCalledTimes(1);

      // Clear and re-trigger
      broadcaster.clearContextWarningCompact('s1');
      await broadcaster.broadcastStatusChange(session, 'context_warning' as any, 'working' as any, {
        statusText: 'warning',
        interactiveContent: null,
      });
      expect(deps.statusChange).toHaveBeenCalledTimes(2);
    });
  });
});
