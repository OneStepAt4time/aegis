import type { PendingPermissionInfo } from './api-contracts.js';

export type PermissionDecision = 'allow' | 'deny';

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
  toolName?: string;
  prompt?: string;
  createdAt: number;
  timeoutMs: number;
}

export class PermissionRequestManager {
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  waitForPermissionDecision(
    sessionId: string,
    timeoutMs: number = 10_000,
    toolName?: string,
    prompt?: string,
  ): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      const createdAt = Date.now();
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(sessionId);
        console.log(`Hooks: PermissionRequest timeout for session ${sessionId} - auto-rejecting`);
        resolve('deny');
      }, timeoutMs);

      this.pendingPermissions.set(sessionId, {
        resolve,
        timer,
        toolName,
        prompt,
        createdAt,
        timeoutMs,
      });
    });
  }

  hasPendingPermission(sessionId: string): boolean {
    return this.pendingPermissions.has(sessionId);
  }

  getPendingPermissionInfo(sessionId: string): PendingPermissionInfo | null {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return null;

    const expiresAt = pending.createdAt + pending.timeoutMs;
    return {
      toolName: pending.toolName,
      prompt: pending.prompt,
      startedAt: pending.createdAt,
      timeoutMs: pending.timeoutMs,
      expiresAt,
      remainingMs: Math.max(0, expiresAt - Date.now()),
    };
  }

  resolvePendingPermission(sessionId: string, decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(sessionId);
    pending.resolve(decision);
    return true;
  }

  cleanupPendingPermission(sessionId: string): void {
    const pending = this.pendingPermissions.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(sessionId);
    }
  }
}
