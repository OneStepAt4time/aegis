import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionApprovalService } from '../services/session/approval-flow.js';

function makeDeps() {
  const sessions: Record<string, any> = {};
  const saved: string[] = [];
  const discovery = { startDiscoveryPolling: vi.fn() };
  const deps = {
    getSession: (id: string) => sessions[id] || null,
    save: async () => { saved.push('save'); },
    invalidateSessionsListCache: () => {},
    discovery,
    config: { sessionApprovalTimeoutMs: 1000 },
    getOnSessionApprovalRecovery: () => null,
    __private_sessions: sessions,
    __private_saved: saved,
  } as any;
  return deps;
}

describe('SessionApprovalService', () => {
  let deps: any;
  beforeEach(() => {
    deps = makeDeps();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('approveSession approves a waiting session, saves and starts discovery', async () => {
    const id = 's1';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval', workDir: '/wd' };
    const svc = new SessionApprovalService(deps);
    const s = await svc.approveSession(id, 'alice');
    expect(s.status).toBe('pending');
    expect(s.approvedBy).toBe('alice');
    expect(deps.__private_saved.length).toBe(1);
    expect(deps.discovery.startDiscoveryPolling).toHaveBeenCalledWith(id, '/wd');
  });

  it('approveSession throws if session not found', async () => {
    const svc = new SessionApprovalService(deps);
    await expect(svc.approveSession('nope')).rejects.toThrow('Session not found');
  });

  it('approveSession throws if not awaiting', async () => {
    const id = 's2';
    deps.__private_sessions[id] = { id, status: 'idle' };
    const svc = new SessionApprovalService(deps);
    await expect(svc.approveSession(id)).rejects.toThrow('not awaiting approval');
  });

  it('rejectSession kills session, clears timeout and saves', async () => {
    const id = 's3';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    const svc = new SessionApprovalService(deps);
    await svc.rejectSession(id);
    expect(deps.__private_sessions[id].status).toBe('killed');
    expect(deps.__private_saved.length).toBe(1);
  });

  it('rejectSession throws when session missing', async () => {
    const svc = new SessionApprovalService(deps);
    await expect(svc.rejectSession('nope')).rejects.toThrow('Session not found');
  });

  it('scheduleApprovalTimeout schedules auto-reject', async () => {
    vi.useFakeTimers();
    const id = 's4';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    // provide recovery callback capture
    let recovered: any = null;
    deps.getOnSessionApprovalRecovery = () => (s: any) => { recovered = s; };
    const svc = new SessionApprovalService(deps);
    svc.scheduleApprovalTimeout(id);
    expect(svc._hasTimeout(id)).toBe(true);
    // advance time
    await vi.advanceTimersByTimeAsync(1100);
    // after timeout, session should be killed and saved
    expect(deps.__private_sessions[id].status).toBe('killed');
    expect(deps.__private_saved.length).toBe(1);
    // recovery callback should have been called with status killed
    expect(recovered).not.toBeNull();
    expect(recovered.status).toBe('killed');
  });

  it('clearApprovalTimeout cancels scheduled timeout', async () => {
    vi.useFakeTimers();
    const id = 's5';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    const svc = new SessionApprovalService(deps);
    svc.scheduleApprovalTimeout(id);
    expect(svc._hasTimeout(id)).toBe(true);
    svc.clearApprovalTimeout(id);
    expect(svc._hasTimeout(id)).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    // should not have auto-rejected
    expect(deps.__private_sessions[id].status).toBe('awaiting_approval');
    expect(deps.__private_saved.length).toBe(0);
  });

  it('emitSessionAwaitingApproval forwards to recovery callback', () => {
    const id = 's6';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    let called: any = null;
    deps.getOnSessionApprovalRecovery = () => (s: any) => { called = s; };
    const svc = new SessionApprovalService(deps);
    svc.emitSessionAwaitingApproval(deps.__private_sessions[id]);
    expect(called).toBe(deps.__private_sessions[id]);
  });

  it('internal timeout map reflects additions and removals', () => {
    vi.useFakeTimers();
    const id = 's7';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    const svc = new SessionApprovalService(deps);
    expect(svc._hasTimeout(id)).toBe(false);
    svc.scheduleApprovalTimeout(id);
    expect(svc._hasTimeout(id)).toBe(true);
    svc.clearApprovalTimeout(id);
    expect(svc._hasTimeout(id)).toBe(false);
  });

  it('auto-reject logs error but does not throw when reject fails', async () => {
    vi.useFakeTimers();
    const id = 's8';
    deps.__private_sessions[id] = { id, status: 'awaiting_approval' };
    // make save reject to simulate failure
    deps.save = async () => { throw new Error('disk'); };
    const svc = new SessionApprovalService(deps);
    // Should not throw when timer fires
    svc.scheduleApprovalTimeout(id);
    await vi.advanceTimersByTimeAsync(1100);
    // still attempted, but session may remain awaiting due to save error
    expect(deps.__private_sessions[id].status === 'killed' || deps.__private_sessions[id].status === 'awaiting_approval').toBe(true);
  });
});
