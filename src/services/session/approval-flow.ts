import type { Config } from '../../config.js';
import type { SessionInfo } from '../../session-types.js';
import { StructuredLogger } from '../../logger.js';

export class SessionApprovalService {
  private readonly approvalTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly logger: StructuredLogger;

  constructor(private deps: {
    getSession: (id: string) => SessionInfo | undefined | null;
    save: () => Promise<void>;
    invalidateSessionsListCache: () => void;
    discovery: { startDiscoveryPolling: (id: string, workDir: string) => void };
    config: Config;
    getOnSessionApprovalRecovery: () => ((session: SessionInfo) => void) | null | undefined;
  }) {
    this.logger = new StructuredLogger();
  }

  scheduleApprovalTimeout(sessionId: string): void {
    const timeoutMs = this.deps.config.sessionApprovalTimeoutMs ?? 300_000;
    const handle = setTimeout(async () => {
      this.approvalTimeouts.delete(sessionId);
      const session = this.deps.getSession(sessionId);
      if (session && session.status === 'awaiting_approval') {
        this.logger.warn({ component: 'session', operation: 'autoRejectApproval', sessionId, attributes: { timeoutMs } });
        try {
          await this.rejectSession(sessionId);
          const cb = this.deps.getOnSessionApprovalRecovery?.();
          if (cb) cb({ ...session, status: 'killed' });
        } catch (e) {
          this.logger.error({ component: 'session', operation: 'autoRejectFailed', sessionId, attributes: { error: String(e) } });
        }
      }
    }, timeoutMs);
    this.approvalTimeouts.set(sessionId, handle);
  }

  clearApprovalTimeout(sessionId: string): void {
    const handle = this.approvalTimeouts.get(sessionId);
    if (handle) {
      clearTimeout(handle);
      this.approvalTimeouts.delete(sessionId);
    }
  }

  emitSessionAwaitingApproval(session: SessionInfo): void {
    const cb = this.deps.getOnSessionApprovalRecovery?.();
    if (cb) cb(session);
  }

  async approveSession(id: string, approvedBy?: string): Promise<SessionInfo> {
    const session = this.deps.getSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') throw new Error(`Session is not awaiting approval`);
    session.status = 'pending';
    session.awaitingApproval = false;
    (session as any).approvedBy = approvedBy;
    (session as any).approvedAt = Date.now();
    this.deps.invalidateSessionsListCache();
    this.clearApprovalTimeout(id);
    await this.deps.save();
    try {
      this.deps.discovery.startDiscoveryPolling(id, session.workDir);
    } catch (e) {
      this.logger.error({ component: 'session', operation: 'approveDiscoveryFailed', sessionId: id, attributes: { error: String(e) } });
    }
    return session;
  }

  async rejectSession(id: string): Promise<void> {
    const session = this.deps.getSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') throw new Error(`Session is not awaiting approval`);
    session.status = 'killed';
    session.awaitingApproval = false;
    this.deps.invalidateSessionsListCache();
    this.clearApprovalTimeout(id);
    await this.deps.save();
  }

  // test helpers
  _hasTimeout(id: string): boolean {
    return this.approvalTimeouts.has(id);
  }
}
