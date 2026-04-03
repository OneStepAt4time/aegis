export type PermissionDecision = 'allow' | 'deny';

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
  toolName?: string;
  prompt?: string;
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
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(sessionId);
        console.log(`Hooks: PermissionRequest timeout for session ${sessionId} - auto-rejecting`);
        resolve('deny');
      }, timeoutMs);

      this.pendingPermissions.set(sessionId, { resolve, timer, toolName, prompt });
    });
  }

  hasPendingPermission(sessionId: string): boolean {
    return this.pendingPermissions.has(sessionId);
  }

  getPendingPermissionInfo(sessionId: string): { toolName?: string; prompt?: string } | null {
    const pending = this.pendingPermissions.get(sessionId);
    return pending ? { toolName: pending.toolName, prompt: pending.prompt } : null;
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