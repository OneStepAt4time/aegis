/**
 * backend-errors.test.ts — Tests for ACP backend error classes.
 *
 * Covers AcpBackendLifecycleError and AcpBackendRuntimeUnavailableError
 * from src/services/acp/backend/errors.ts (currently at ~0% coverage).
 */

import { describe, it, expect } from 'vitest';
import {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
} from '../services/acp/backend/errors.js';

describe('ACP backend error classes', () => {
  it('AcpBackendLifecycleError has correct name, message, and instanceof', () => {
    const err = new AcpBackendLifecycleError('lifecycle failed');
    expect(err.name).toBe('AcpBackendLifecycleError');
    expect(err.message).toBe('lifecycle failed');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AcpBackendLifecycleError);
  });

  it('AcpBackendRuntimeUnavailableError has correct name and session message', () => {
    const err = new AcpBackendRuntimeUnavailableError('sess-abc-123');
    expect(err.name).toBe('AcpBackendRuntimeUnavailableError');
    expect(err.message).toBe('ACP runtime is not active for session: sess-abc-123');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AcpBackendLifecycleError);
    expect(err).toBeInstanceOf(AcpBackendRuntimeUnavailableError);
  });

  it('AcpBackendRuntimeUnavailableError is catchable as AcpBackendLifecycleError', () => {
    const throwIt = () => {
      throw new AcpBackendRuntimeUnavailableError('sess-xyz');
    };
    expect(throwIt).toThrow(AcpBackendLifecycleError);
  });
});
