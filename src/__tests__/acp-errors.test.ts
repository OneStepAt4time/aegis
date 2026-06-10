import { describe, it, expect } from 'vitest';
import { AcpDurableIdentityError, AcpValidationError } from '../services/acp/errors.js';

describe('ACP error classes', () => {
  it('AcpDurableIdentityError has correct name and message', () => {
    const err = new AcpDurableIdentityError('session already exists');
    expect(err.name).toBe('AcpDurableIdentityError');
    expect(err.message).toBe('session already exists');
    expect(err).toBeInstanceOf(Error);
  });

  it('AcpValidationError has correct name and message', () => {
    const err = new AcpValidationError('invalid scope');
    expect(err.name).toBe('AcpValidationError');
    expect(err.message).toBe('invalid scope');
    expect(err).toBeInstanceOf(Error);
  });
});
