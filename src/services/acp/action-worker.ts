import type { AcpActionMetadata, AcpActionQueue, AcpActionRecord } from './action-queue.js';
import type { AcpSessionScope } from './types.js';

export const ACP_ACTION_WORKER_STALE_LEASE_RECOVERY_POLICY =
  'ACP action worker stale leased action recovery is not implemented until ACP-024 defines a typed requeue or expire contract; recovery is a follow-up and must not be guessed here.';

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_IDLE_DELAY_MS = 1_000;

export interface AcpActionWorkerDispatchResult {
  resultMetadata?: AcpActionMetadata;
}

export interface AcpActionWorkerBackend {
  dispatchAction(action: AcpActionRecord): Promise<AcpActionWorkerDispatchResult>;
}

export interface AcpActionWorkerOptions {
  queue: AcpActionQueue;
  backend: AcpActionWorkerBackend;
  scope: AcpSessionScope;
  leaseDurationMs?: number;
  idleDelayMs?: number;
  clock?: () => Date;
  onError?: (error: Error) => void;
}

export type AcpActionWorkerRunResult =
  | { status: 'idle' }
  | {
      status: 'dispatched';
      actionId: string;
      transition: 'completed' | 'already-finalized';
    }
  | {
      status: 'failed';
      actionId: string;
      transition: 'failed' | 'already-finalized';
    };

export class AcpActionWorkerRuntimeUnavailableError extends Error {
  constructor(readonly sessionId: string) {
    super(`ACP runtime is unavailable for queued action session: ${sessionId}`);
    this.name = 'AcpActionWorkerRuntimeUnavailableError';
  }
}

export class AcpActionWorker {
  private readonly queue: AcpActionQueue;
  private readonly backend: AcpActionWorkerBackend;
  private readonly scope: AcpSessionScope;
  private readonly leaseDurationMs: number;
  private readonly idleDelayMs: number;
  private readonly clock: () => Date;
  private readonly onError: (error: Error) => void;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private loopPromise: Promise<void> | undefined;
  private inFlight: Promise<AcpActionWorkerRunResult> | undefined;

  constructor(options: AcpActionWorkerOptions) {
    this.queue = options.queue;
    this.backend = options.backend;
    this.scope = { tenantId: options.scope.tenantId, ownerKeyId: options.scope.ownerKeyId };
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.clock = options.clock ?? (() => new Date());
    this.onError = options.onError ?? (() => {});
    assertPositiveInteger(this.leaseDurationMs, 'ACP action worker leaseDurationMs');
    assertNonNegativeInteger(this.idleDelayMs, 'ACP action worker idleDelayMs');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.loopPromise;
    await this.inFlight;
  }

  async runOnce(): Promise<AcpActionWorkerRunResult> {
    const now = this.now();
    const action = await this.queue.leaseNext(this.scope, {
      now,
      leaseUntil: new Date(now.getTime() + this.leaseDurationMs),
    });
    if (action === null) return { status: 'idle' };

    this.inFlight = this.dispatchLeasedAction(action);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.loopPromise = this.runLoop();
    }, delayMs);
  }

  private async runLoop(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.onError(normalizeError(error));
    } finally {
      if (this.running) this.schedule(this.idleDelayMs);
    }
  }

  private async dispatchLeasedAction(action: AcpActionRecord): Promise<AcpActionWorkerRunResult> {
    const validationFailure = validateLeasedAction(action, this.scope);
    if (validationFailure !== undefined) {
      return this.failAction(action, {
        category: validationFailure,
        retryPolicy: 'not_defined',
      });
    }

    try {
      const result = await this.backend.dispatchAction(action);
      const completed = await this.queue.complete(action.actionId, this.scope, {
        now: this.now(),
        resultMetadata: result.resultMetadata,
      });
      return {
        status: 'dispatched',
        actionId: action.actionId,
        transition: completed === null ? 'already-finalized' : 'completed',
      };
    } catch (error) {
      return this.failAction(action, errorMetadataFromDispatchError(error, action.sessionId));
    }
  }

  private async failAction(
    action: AcpActionRecord,
    errorMetadata: AcpActionMetadata
  ): Promise<AcpActionWorkerRunResult> {
    const failed = await this.queue.fail(action.actionId, this.scope, {
      now: this.now(),
      errorMetadata,
    });
    return {
      status: 'failed',
      actionId: action.actionId,
      transition: failed === null ? 'already-finalized' : 'failed',
    };
  }

  private now(): Date {
    const value = this.clock();
    if (Number.isNaN(value.getTime())) {
      throw new Error('ACP action worker clock returned an invalid Date');
    }
    return value;
  }
}

function validateLeasedAction(
  action: AcpActionRecord,
  scope: AcpSessionScope
): 'scope_mismatch' | 'invalid_action' | undefined {
  if (action.tenantId !== scope.tenantId || action.ownerKeyId !== scope.ownerKeyId) {
    return 'scope_mismatch';
  }
  if (
    action.status !== 'leased' ||
    !isNonEmptyString(action.actionId) ||
    !isNonEmptyString(action.sessionId)
  ) {
    return 'invalid_action';
  }
  return undefined;
}

function errorMetadataFromDispatchError(error: unknown, sessionId: string): AcpActionMetadata {
  if (isRuntimeUnavailableError(error)) {
    return {
      category: 'runtime_unavailable',
      errorName: error.name,
      retryPolicy: 'not_defined',
    };
  }
  return {
    category: 'dispatch_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    retryPolicy: 'not_defined',
    sessionId,
  };
}

function isRuntimeUnavailableError(error: unknown): error is Error & {
  name: 'AcpActionWorkerRuntimeUnavailableError' | 'AcpBackendRuntimeUnavailableError';
} {
  return (
    error instanceof Error &&
    (error.name === 'AcpActionWorkerRuntimeUnavailableError' ||
      error.name === 'AcpBackendRuntimeUnavailableError')
  );
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
