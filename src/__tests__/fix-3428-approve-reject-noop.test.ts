/**
 * Issue #3428: POST /v1/sessions/:id/approve and /reject return ok:true
 * even when no permission is pending.
 *
 * Expected: 404 or error "No pending permission request"
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../session.js';
import { PermissionRequestManager } from '../permission-request-manager.js';

describe('Issue #3428 — approve/reject with no pending permission', () => {
  let sessions: SessionManager;

  beforeEach(() => {
    sessions = new SessionManager({ stateDir: '/tmp/test-state' } as any, {} as any);
  });

  it('approve throws when no permission is pending', async () => {
    await expect(sessions.approve('session-with-no-permission')).rejects.toThrow('No pending permission request');
  });

  it('reject throws when no permission is pending', async () => {
    await expect(sessions.reject('session-with-no-permission')).rejects.toThrow('No pending permission request');
  });

  it('approve resolves pending permission', async () => {
    const pm = new PermissionRequestManager();
    // Inject permission request manager into session (access private field)
    (sessions as any).permissionRequests = pm;
    
    const promise = pm.waitForPermissionDecision('test-session', 5000);
    
    await sessions.approve('test-session');
    
    const decision = await promise;
    expect(decision).toBe('allow');
  });

  it('reject resolves pending permission', async () => {
    const pm = new PermissionRequestManager();
    (sessions as any).permissionRequests = pm;
    
    const promise = pm.waitForPermissionDecision('test-session', 5000);
    
    await sessions.reject('test-session');
    
    const decision = await promise;
    expect(decision).toBe('deny');
  });
});
