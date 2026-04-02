/**
 * fault-injection.ts — deterministic fault injection harness for integration tests.
 *
 * Disabled by default in production. Enable with AEGIS_FAULT_INJECTION=1
 * or via test helpers.
 */

export type FaultMode = 'transient' | 'fatal' | 'delay';

export interface FaultRule {
  point: string;
  mode: FaultMode;
  every?: number;
  probability?: number;
  delayMs?: number;
  errorMessage?: string;
}

export class InjectedTransientFaultError extends Error {
  readonly point: string;

  constructor(point: string, message?: string) {
    super(message ?? `Injected transient fault at ${point}`);
    this.name = 'InjectedTransientFaultError';
    this.point = point;
  }
}

export class InjectedFatalFaultError extends Error {
  readonly point: string;

  constructor(point: string, message?: string) {
    super(message ?? `Injected fatal fault at ${point}`);
    this.name = 'InjectedFatalFaultError';
    this.point = point;
  }
}

class FaultInjector {
  private readonly rules: FaultRule[] = [];
  private readonly hitCounts = new Map<string, number>();
  private enabledOverride: boolean | null = null;
  private seed = 1;
  private rngState = 1;

  constructor() {
    this.reset();
  }

  private readSeedFromEnv(): number {
    const parsed = Number.parseInt(process.env.AEGIS_FAULT_SEED ?? '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private nextRandom(): number {
    // LCG constants from Numerical Recipes, deterministic and fast.
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private isEnabled(): boolean {
    if (this.enabledOverride !== null) {
      return this.enabledOverride;
    }
    return process.env.AEGIS_FAULT_INJECTION === '1';
  }

  reset(): void {
    this.seed = this.readSeedFromEnv();
    this.rngState = this.seed;
    this.hitCounts.clear();
  }

  clearRules(): void {
    this.rules.length = 0;
    this.hitCounts.clear();
  }

  setEnabledForTest(enabled: boolean): void {
    this.enabledOverride = enabled;
  }

  setSeedForTest(seed: number): void {
    this.seed = seed > 0 ? Math.floor(seed) : 1;
    this.rngState = this.seed;
  }

  addRule(rule: FaultRule): void {
    this.rules.push(rule);
  }

  async inject(point: string): Promise<void> {
    if (!this.isEnabled()) return;

    for (const rule of this.rules) {
      if (rule.point !== point) continue;

      const count = (this.hitCounts.get(point) ?? 0) + 1;
      this.hitCounts.set(point, count);

      let shouldTrigger = true;
      if (rule.every && rule.every > 0) {
        shouldTrigger = count % rule.every === 0;
      } else if (typeof rule.probability === 'number') {
        shouldTrigger = this.nextRandom() < Math.max(0, Math.min(1, rule.probability));
      }

      if (!shouldTrigger) continue;

      if (rule.mode === 'delay') {
        const ms = Math.max(0, rule.delayMs ?? 0);
        if (ms > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, ms));
        }
        return;
      }

      if (rule.mode === 'transient') {
        throw new InjectedTransientFaultError(point, rule.errorMessage);
      }

      throw new InjectedFatalFaultError(point, rule.errorMessage);
    }
  }
}

const injector = new FaultInjector();

export function maybeInjectFault(point: string): Promise<void> {
  return injector.inject(point);
}

export function resetFaultInjection(): void {
  injector.reset();
}

export function clearFaultRules(): void {
  injector.clearRules();
}

export function setFaultInjectionEnabledForTest(enabled: boolean): void {
  injector.setEnabledForTest(enabled);
}

export function setFaultInjectionSeedForTest(seed: number): void {
  injector.setSeedForTest(seed);
}

export function addFaultRule(rule: FaultRule): void {
  injector.addRule(rule);
}
