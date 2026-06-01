import { AcpDurableIdentityError } from '../errors.js';
import type { AcpSessionRecord, AcpSessionScope, AcpSessionStore, AcpListSessionsInput } from '../types.js';
import { cloneSession } from './clone.js';
import { resolveSessionListLimit, validateScope } from './validation.js';
import { createEmptyState, noopMutationHook } from './types.js';
import type { LocalState, MutationHook } from './types.js';

/**
 * In-memory implementation of the session store. Shares a `LocalState`
 * container with the other Memory* stores and the file-backed profile,
 * so all mutations are observable to persistence via the `onMutation` hook.
 */
export class MemoryAcpSessionStore implements AcpSessionStore {
  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook
  ) {}

  async create(record: AcpSessionRecord): Promise<void> {
    const existing = this.state.sessions.find(
      session =>
        session.id === record.id &&
        session.tenantId === record.tenantId &&
        session.ownerKeyId === record.ownerKeyId
    );
    if (existing !== undefined) {
      throw new AcpDurableIdentityError(`ACP session already exists: ${record.id}`);
    }
    this.state.sessions.push(cloneSession(record));
    await this.onMutation();
  }

  async get(id: string, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    validateScope(scope);
    const record = this.state.sessions.find(
      session =>
        session.id === id &&
        session.tenantId === scope.tenantId &&
        session.ownerKeyId === scope.ownerKeyId
    );
    return record === undefined ? null : cloneSession(record);
  }

  async update(record: AcpSessionRecord, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    validateScope(scope);
    if (record.tenantId !== scope.tenantId || record.ownerKeyId !== scope.ownerKeyId) {
      throw new Error('MemoryAcpSessionStore: record scope does not match requested scope');
    }
    const index = this.state.sessions.findIndex(
      session =>
        session.id === record.id &&
        session.tenantId === scope.tenantId &&
        session.ownerKeyId === scope.ownerKeyId
    );
    const previous = this.state.sessions[index];
    if (previous === undefined) return null;
    const persisted: AcpSessionRecord = {
      ...previous,
      acpAgentSessionId: record.acpAgentSessionId,
      claudeSessionId: record.claudeSessionId,
      currentBackendRunId: record.currentBackendRunId,
      status: record.status,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
      failedAt: record.failedAt,
      backendMetadata: record.backendMetadata === undefined ? undefined : { ...record.backendMetadata },
      validationWarnings: record.validationWarnings,
    };
    this.state.sessions[index] = cloneSession(persisted);
    await this.onMutation();
    return cloneSession(persisted);
  }

  async list(input: AcpListSessionsInput): Promise<AcpSessionRecord[]> {
    validateScope(input);
    const limit = resolveSessionListLimit(input.limit);
    return this.state.sessions
      .filter(
        session =>
          session.tenantId === input.tenantId &&
          session.ownerKeyId === input.ownerKeyId &&
          (input.statuses === undefined || input.statuses.includes(session.status)) &&
          (input.updatedAfter === undefined || session.updatedAt > input.updatedAfter)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(cloneSession);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }
}
