import { describe, expect, it } from 'vitest';
import { TmuxManager } from '../tmux.js';

interface QueueHarness {
  queue: Promise<void>;
  serialize<T>(fn: () => Promise<T>): Promise<T>;
}

function createQueueHarness(): QueueHarness {
  return new TmuxManager('queue-recovery-session', 'queue-recovery-socket') as unknown as QueueHarness;
}

function poisonQueue(harness: QueueHarness, marker: string): void {
  const poisonedQueue = Promise.reject(new Error(`poisoned-queue:${marker}`));
  void poisonedQueue.catch(() => undefined);
  harness.queue = poisonedQueue;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 1_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function expectRejectedMessage(result: PromiseSettledResult<string>, expected: string): void {
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') return;
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  expect(message).toContain(expected);
}

describe('TmuxManager serialize queue rejection recovery (Issue #1615)', () => {
  it('single rejection recovery: subsequent operation still runs', async () => {
    const harness = createQueueHarness();
    const executed: string[] = [];
    poisonQueue(harness, 'single');

    await expect(withTimeout(harness.serialize(async () => {
      executed.push('first');
      throw new Error('first failure');
    }))).rejects.toThrow('first failure');

    await expect(withTimeout(harness.serialize(async () => {
      executed.push('second');
      return 'ok';
    }))).resolves.toBe('ok');

    expect(executed).toEqual(['first', 'second']);
  });

  it('repeated rejection recovery: queue continues after multiple failures', async () => {
    const harness = createQueueHarness();
    const executed: string[] = [];
    poisonQueue(harness, 'repeated');

    await expect(withTimeout(harness.serialize(async () => {
      executed.push('first');
      throw new Error('fail-1');
    }))).rejects.toThrow('fail-1');

    await expect(withTimeout(harness.serialize(async () => {
      executed.push('second');
      throw new Error('fail-2');
    }))).rejects.toThrow('fail-2');

    await expect(withTimeout(harness.serialize(async () => {
      executed.push('third');
      return 'recovered';
    }))).resolves.toBe('recovered');

    expect(executed).toEqual(['first', 'second', 'third']);
  });

  it('mixed success/failure sequence runs in order without queue poisoning', async () => {
    const harness = createQueueHarness();
    const executed: string[] = [];
    poisonQueue(harness, 'mixed');

    const operations = [
      withTimeout(harness.serialize(async () => {
        executed.push('success-1');
        return 'success-1';
      })),
      withTimeout(harness.serialize(async () => {
        executed.push('failure-1');
        throw new Error('failure-1');
      })),
      withTimeout(harness.serialize(async () => {
        executed.push('success-2');
        return 'success-2';
      })),
      withTimeout(harness.serialize(async () => {
        executed.push('failure-2');
        throw new Error('failure-2');
      })),
      withTimeout(harness.serialize(async () => {
        executed.push('success-3');
        return 'success-3';
      })),
    ];

    const results = await Promise.allSettled(operations);

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 'success-1' });
    expectRejectedMessage(results[1], 'failure-1');
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: 'success-2' });
    expectRejectedMessage(results[3], 'failure-2');
    expect(results[4]).toMatchObject({ status: 'fulfilled', value: 'success-3' });
    expect(executed).toEqual(['success-1', 'failure-1', 'success-2', 'failure-2', 'success-3']);
  });
});
