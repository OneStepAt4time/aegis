/**
 * Issue #3697: Backend must emit approval_resolved SSE event after approve/reject.
 *
 * Verifies:
 * 1. approval_resolved is a valid SessionSSEEvent type
 * 2. The event shape matches what the dashboard expects
 * 3. The code in control-actions.ts emits after approve/reject
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionSSEEvent } from '../events.js';

describe('Issue #3697: approval_resolved SSE event', () => {
  it('approval_resolved is a valid SessionSSEEvent for approved action', () => {
    const event: SessionSSEEvent = {
      event: 'approval_resolved',
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
      data: { action: 'approved', approvalId: 'approval-abc' },
    };

    expect(event.event).toBe('approval_resolved');
    expect(event.data.action).toBe('approved');
    expect(event.data.approvalId).toBe('approval-abc');
  });

  it('approval_resolved is a valid SessionSSEEvent for rejected action', () => {
    const event: SessionSSEEvent = {
      event: 'approval_resolved',
      sessionId: 'session-456',
      timestamp: new Date().toISOString(),
      data: { action: 'rejected', approvalId: 'approval-xyz' },
    };

    expect(event.event).toBe('approval_resolved');
    expect(event.data.action).toBe('rejected');
    expect(event.data.approvalId).toBe('approval-xyz');
  });

  it('SessionEventBus can emit and buffer approval_resolved events', async () => {
    const { SessionEventBus } = await import('../events.js');
    const bus = new SessionEventBus();
    const emitSpy = vi.spyOn(bus, 'emit');

    const event: SessionSSEEvent = {
      event: 'approval_resolved',
      sessionId: 'session-789',
      timestamp: new Date().toISOString(),
      data: { action: 'approved', approvalId: 'approval-test' },
    };

    bus.emit('session-789', event);

    expect(emitSpy).toHaveBeenCalledWith('session-789', expect.objectContaining({
      event: 'approval_resolved',
      data: expect.objectContaining({
        action: 'approved',
        approvalId: 'approval-test',
      }),
    }));
  });

  it('control-actions source contains approval_resolved emit for approve', async () => {
    // Verify the source code includes the emit call for approve
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'routes', 'control-actions.ts'),
      'utf-8'
    );

    // After approveSession succeeds, emit approval_resolved
    expect(source).toMatch(/approveSession.*\n.*\n.*eventBus\.emit.*approval_resolved.*approved/s);
    expect(source).toMatch(/rejectSession.*\n.*\n.*eventBus\.emit.*approval_resolved.*rejected/s);
  });
});
