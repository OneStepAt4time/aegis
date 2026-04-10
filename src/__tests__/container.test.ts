import { describe, expect, it } from 'vitest';
import { ServiceContainer, type LifecycleService } from '../container.js';

function makeLifecycle(
  name: string,
  events: string[],
  overrides: Partial<LifecycleService> = {},
): LifecycleService {
  return {
    async start(): Promise<void> {
      events.push(`start:${name}`);
    },
    async stop(): Promise<void> {
      events.push(`stop:${name}`);
    },
    async health(): Promise<{ healthy: boolean }> {
      return { healthy: true };
    },
    ...overrides,
  };
}

describe('ServiceContainer', () => {
  it('starts in dependency order and stops in reverse dependency order', async () => {
    const events: string[] = [];
    const container = new ServiceContainer();

    container.register('tmux', {}, makeLifecycle('tmux', events));
    container.register('sessions', {}, makeLifecycle('sessions', events), ['tmux']);
    container.register('channels', {}, makeLifecycle('channels', events), ['sessions']);

    await container.start(['channels']);
    expect(events).toEqual([
      'start:tmux',
      'start:sessions',
      'start:channels',
    ]);

    await container.stopAll();
    expect(events).toEqual([
      'start:tmux',
      'start:sessions',
      'start:channels',
      'stop:channels',
      'stop:sessions',
      'stop:tmux',
    ]);
  });

  it('fails on missing dependencies', async () => {
    const container = new ServiceContainer();
    container.register('sessions', {}, makeLifecycle('sessions', []), ['tmux']);

    await expect(container.startAll()).rejects.toThrow(
      'Service "sessions" depends on unregistered service "tmux"',
    );
  });

  it('fails on circular dependencies', async () => {
    const container = new ServiceContainer();
    container.register('a', {}, makeLifecycle('a', []), ['b']);
    container.register('b', {}, makeLifecycle('b', []), ['a']);

    await expect(container.startAll()).rejects.toThrow('Circular service dependency');
  });

  it('enforces startup health gate', async () => {
    const container = new ServiceContainer();
    container.register('healthy', {}, makeLifecycle('healthy', []));
    container.register('unhealthy', {}, makeLifecycle('unhealthy', [], {
      async health() {
        return { healthy: false, details: 'simulated failure' };
      },
    }));

    await container.startAll();
    await expect(container.assertHealthy()).rejects.toThrow(
      'Service health gate failed: unhealthy (simulated failure)',
    );
  });

  it('continues shutdown when a service times out', async () => {
    const events: string[] = [];
    const container = new ServiceContainer();

    container.register('fast', {}, makeLifecycle('fast', events));
    container.register('slow', {}, makeLifecycle('slow', events, {
      async stop(): Promise<void> {
        events.push('stop:slow:pending');
        await new Promise<void>(() => {});
      },
    }), ['fast']);

    await container.startAll();
    const results = await container.stopAll({ timeoutMs: 20 });

    expect(results).toEqual([
      { name: 'slow', status: 'timeout' },
      { name: 'fast', status: 'stopped' },
    ]);
    expect(events).toContain('stop:slow:pending');
    expect(events).toContain('stop:fast');
  });

  it('rolls back newly started services when startup fails', async () => {
    const events: string[] = [];
    const container = new ServiceContainer();

    container.register('tmux', {}, makeLifecycle('tmux', events));
    container.register('sessions', {}, makeLifecycle('sessions', events, {
      async start(): Promise<void> {
        events.push('start:sessions');
        throw new Error('session startup failed');
      },
    }), ['tmux']);

    await expect(container.startAll()).rejects.toThrow('session startup failed');
    expect(events).toEqual([
      'start:tmux',
      'start:sessions',
      'stop:tmux',
    ]);
  });
});
