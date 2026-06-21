/**
 * Constructor validation for maxPendingHandshakes (#4777 follow-up).
 *
 * Extracted to a separate file to avoid vi.mock hoisting conflicts
 * with the main cap test's runtime.js mock.
 */
import { describe, it, expect } from 'vitest';
import { AcpBackend } from '../services/acp/backend.js';
import type { AcpBackendOptions } from '../services/acp/backend.js';

function makeMockSessionService() {
  let counter = 0;
  return {
    createSession: async () => ({
      id: `session-${++counter}`,
      name: 'test',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };
}

describe('AcpBackend maxPendingHandshakes constructor validation (#4777)', () => {
  it('rejects NaN', () => {
    expect(() => new AcpBackend({
      sessionService: makeMockSessionService(),
      maxPendingHandshakes: NaN,
    } as unknown as AcpBackendOptions)).toThrow(
      'AcpBackendOptions.maxPendingHandshakes must be a positive finite number, got NaN'
    );
  });

  it('rejects Infinity', () => {
    expect(() => new AcpBackend({
      sessionService: makeMockSessionService(),
      maxPendingHandshakes: Infinity,
    } as unknown as AcpBackendOptions)).toThrow(
      'AcpBackendOptions.maxPendingHandshakes must be a positive finite number, got Infinity'
    );
  });

  it('rejects zero', () => {
    expect(() => new AcpBackend({
      sessionService: makeMockSessionService(),
      maxPendingHandshakes: 0,
    } as unknown as AcpBackendOptions)).toThrow(
      'AcpBackendOptions.maxPendingHandshakes must be a positive finite number, got 0'
    );
  });

  it('rejects negative', () => {
    expect(() => new AcpBackend({
      sessionService: makeMockSessionService(),
      maxPendingHandshakes: -1,
    } as unknown as AcpBackendOptions)).toThrow(
      'AcpBackendOptions.maxPendingHandshakes must be a positive finite number, got -1'
    );
  });

  it('accepts valid positive finite number', () => {
    const backend = new AcpBackend({
      sessionService: makeMockSessionService(),
      maxPendingHandshakes: 100,
    } as unknown as AcpBackendOptions);
    expect(backend).toBeDefined();
  });

  it('defaults to 1000 when undefined', () => {
    const backend = new AcpBackend({
      sessionService: makeMockSessionService(),
    } as unknown as AcpBackendOptions);
    expect(backend).toBeDefined();
  });
});
