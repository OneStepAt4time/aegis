export interface ServiceHealth {
  healthy: boolean;
  details?: string;
}

export interface LifecycleService {
  start(): Promise<void>;
  stop(signal: AbortSignal): Promise<void>;
  health?(): Promise<ServiceHealth>;
}

interface ServiceRegistration<T = unknown> {
  name: string;
  instance: T;
  lifecycle: LifecycleService;
  dependencies: string[];
}

export interface ServiceHealthResult extends ServiceHealth {
  name: string;
}

export interface ServiceStopResult {
  name: string;
  status: 'stopped' | 'timeout' | 'error';
  error?: Error;
}

export interface ServiceStopOptions {
  timeoutMs?: number;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export class ServiceContainer {
  private readonly services = new Map<string, ServiceRegistration>();
  private readonly registrationOrder: string[] = [];
  private readonly started = new Set<string>();
  private readonly startOrder: string[] = [];

  register<T>(
    name: string,
    instance: T,
    lifecycle: LifecycleService,
    dependencies: readonly string[] = [],
  ): T {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this.services.set(name, {
      name,
      instance,
      lifecycle,
      dependencies: [...dependencies],
    });
    this.registrationOrder.push(name);
    return instance;
  }

  resolve<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service "${name}" is not registered`);
    }
    return service.instance as T;
  }

  async start(names: readonly string[]): Promise<string[]> {
    const startPlan = this.resolveStartOrder(names);
    const startedNow: string[] = [];
    try {
      for (const name of startPlan) {
        if (this.started.has(name)) continue;
        const service = this.services.get(name)!;
        await service.lifecycle.start();
        this.started.add(name);
        this.startOrder.push(name);
        startedNow.push(name);
      }
      return startedNow;
    } catch (error) {
      await this.stopServices([...startedNow].reverse(), 5_000);
      throw error;
    }
  }

  async startAll(): Promise<string[]> {
    return this.start(this.registrationOrder);
  }

  async checkHealth(names?: readonly string[]): Promise<ServiceHealthResult[]> {
    const healthPlan = names ? this.resolveStartOrder(names) : this.startOrder;
    const report: ServiceHealthResult[] = [];

    for (const name of healthPlan) {
      if (!this.started.has(name)) continue;
      const service = this.services.get(name)!;
      if (!service.lifecycle.health) {
        report.push({ name, healthy: true });
        continue;
      }
      try {
        const result = await service.lifecycle.health();
        report.push({ name, healthy: result.healthy, details: result.details });
      } catch (error) {
        report.push({
          name,
          healthy: false,
          details: `health check failed: ${toError(error).message}`,
        });
      }
    }
    return report;
  }

  async assertHealthy(names?: readonly string[]): Promise<ServiceHealthResult[]> {
    const report = await this.checkHealth(names);
    const unhealthy = report.filter(service => !service.healthy);
    if (unhealthy.length > 0) {
      const reason = unhealthy
        .map(service => `${service.name}${service.details ? ` (${service.details})` : ''}`)
        .join(', ');
      throw new Error(`Service health gate failed: ${reason}`);
    }
    return report;
  }

  async stopAll(options: ServiceStopOptions = {}): Promise<ServiceStopResult[]> {
    const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
    const names = [...this.startOrder].reverse();
    const results = await this.stopServices(names, timeoutMs);
    this.startOrder.length = 0;
    this.started.clear();
    return results;
  }

  private async stopServices(names: readonly string[], timeoutMs: number): Promise<ServiceStopResult[]> {
    const results: ServiceStopResult[] = [];

    for (const name of names) {
      if (!this.started.has(name)) continue;
      const service = this.services.get(name);
      if (!service) continue;

      const abortController = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const stopPromise = Promise.resolve()
        .then(() => service.lifecycle.stop(abortController.signal))
        .then(() => ({ status: 'stopped' as const }))
        .catch((error: unknown) => ({ status: 'error' as const, error: toError(error) }));
      const timeoutPromise = new Promise<{ status: 'timeout' }>((resolve) => {
        timer = setTimeout(() => {
          abortController.abort();
          resolve({ status: 'timeout' });
        }, timeoutMs);
      });

      const outcome = await Promise.race([stopPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);

      this.started.delete(name);
      const startOrderIndex = this.startOrder.indexOf(name);
      if (startOrderIndex >= 0) this.startOrder.splice(startOrderIndex, 1);

      if (outcome.status === 'timeout') {
        results.push({ name, status: 'timeout' });
        continue;
      }

      if (outcome.status === 'error') {
        results.push({ name, status: 'error', error: outcome.error });
        continue;
      }

      results.push({ name, status: 'stopped' });
    }
    return results;
  }

  private resolveStartOrder(names: readonly string[]): string[] {
    const order: string[] = [];
    const state = new Map<string, 'visiting' | 'visited'>();

    const visit = (name: string, stack: string[]): void => {
      const service = this.services.get(name);
      if (!service) {
        throw new Error(`Service "${name}" is not registered`);
      }

      const currentState = state.get(name);
      if (currentState === 'visited') return;
      if (currentState === 'visiting') {
        throw new Error(`Circular service dependency: ${[...stack, name].join(' -> ')}`);
      }

      state.set(name, 'visiting');
      for (const dependency of service.dependencies) {
        if (!this.services.has(dependency)) {
          throw new Error(`Service "${name}" depends on unregistered service "${dependency}"`);
        }
        visit(dependency, [...stack, name]);
      }
      state.set(name, 'visited');
      order.push(name);
    };

    for (const name of names) {
      visit(name, []);
    }

    return order;
  }
}
