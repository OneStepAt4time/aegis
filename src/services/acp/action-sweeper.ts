import type { AcpActionQueue, AcpActionRecord } from './action-queue.js';

/** Configuration for the orphan action sweeper. */
export interface ActionSweeperConfig {
  /** Whether the sweeper is enabled. Default: true. */
  enabled?: boolean;
  /** Sweep interval in milliseconds. Default: 60_000. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const ENV_ENABLED = 'AEGIS_ACTION_SWEEPER_ENABLED';
const ENV_INTERVAL_MS = 'AEGIS_ACTION_SWEEPER_INTERVAL_MS';

/** Reads sweeper config from environment variables, with explicit overrides taking precedence. */
export function resolveSweeperConfig(overrides: ActionSweeperConfig = {}): Required<ActionSweeperConfig> {
  const envEnabled = process.env[ENV_ENABLED];
  const envInterval = process.env[ENV_INTERVAL_MS];

  let enabled = true;
  if (overrides.enabled !== undefined) {
    enabled = overrides.enabled;
  } else if (envEnabled !== undefined) {
    enabled = envEnabled !== 'false' && envEnabled !== '0';
  }

  let intervalMs = DEFAULT_INTERVAL_MS;
  if (overrides.intervalMs !== undefined) {
    intervalMs = overrides.intervalMs;
  } else if (envInterval !== undefined) {
    const parsed = Number.parseInt(envInterval, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      intervalMs = parsed;
    }
  }

  return { enabled, intervalMs };
}

export interface ActionSweeperCallbacks {
  onRecovered?: (actions: AcpActionRecord[]) => void;
  onError?: (error: unknown) => void;
}

/**
 * Periodically sweeps the action queue for orphaned (stale-leased) actions.
 * Call `start()` to begin the sweep loop, `stop()` to end it.
 */
export class ActionSweeper {
  private readonly queue: AcpActionQueue;
  private readonly intervalMs: number;
  private readonly callbacks: ActionSweeperCallbacks;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    queue: AcpActionQueue,
    config: Required<ActionSweeperConfig>,
    callbacks: ActionSweeperCallbacks = {}
  ) {
    this.queue = queue;
    this.intervalMs = config.intervalMs;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, this.intervalMs);
    // Prevent the timer from keeping the process alive
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sweepOnce(): Promise<void> {
    try {
      const recovered = await this.queue.sweepOrphanedActions();
      if (recovered.length > 0 && this.callbacks.onRecovered) {
        this.callbacks.onRecovered(recovered);
      }
    } catch (err) {
      if (this.callbacks.onError) {
        this.callbacks.onError(err);
      }
    }
  }
}
