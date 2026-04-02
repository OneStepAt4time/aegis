/**
 * capability-handshake-885.test.ts — Tests for capability handshake negotiation.
 *
 * Issue #885: Verifies that:
 * 1. Full-capability client gets all negotiated capabilities
 * 2. Partial-capability client gets only the intersection
 * 3. Unsupported protocol version → not compatible + warning
 * 4. Newer client version gets forward-compat warning but remains compatible
 * 5. Unknown capabilities are ignored with a warning
 */

import { describe, it, expect } from 'vitest';
import {
  negotiate,
  AEGIS_CAPABILITIES,
  AEGIS_PROTOCOL_VERSION,
} from '../handshake.js';

describe('negotiate', () => {
  it('full-capability client gets all server capabilities', () => {
    const result = negotiate({
      protocolVersion: AEGIS_PROTOCOL_VERSION,
      clientCapabilities: [...AEGIS_CAPABILITIES],
    });
    expect(result.compatible).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.negotiatedCapabilities).toEqual([...AEGIS_CAPABILITIES]);
    expect(result.serverCapabilities).toEqual([...AEGIS_CAPABILITIES]);
    expect(result.protocolVersion).toBe(AEGIS_PROTOCOL_VERSION);
  });

  it('partial-capability client gets intersection only', () => {
    const result = negotiate({
      protocolVersion: AEGIS_PROTOCOL_VERSION,
      clientCapabilities: ['session.create', 'session.approve'],
    });
    expect(result.compatible).toBe(true);
    expect(result.negotiatedCapabilities).toEqual(['session.create', 'session.approve']);
    expect(result.negotiatedCapabilities).not.toContain('session.transcript');
  });

  it('client with no declared capabilities gets full server set', () => {
    const result = negotiate({ protocolVersion: AEGIS_PROTOCOL_VERSION });
    expect(result.compatible).toBe(true);
    expect(result.negotiatedCapabilities).toEqual([...AEGIS_CAPABILITIES]);
  });

  it('unknown client capabilities are ignored with a warning', () => {
    const result = negotiate({
      protocolVersion: AEGIS_PROTOCOL_VERSION,
      clientCapabilities: ['session.create', 'some.future.feature'],
    });
    expect(result.compatible).toBe(true);
    expect(result.negotiatedCapabilities).toContain('session.create');
    expect(result.negotiatedCapabilities).not.toContain('some.future.feature');
    expect(result.warnings.some(w => w.includes('some.future.feature'))).toBe(true);
  });

  it('protocol version below minimum → not compatible + warning', () => {
    const result = negotiate({
      protocolVersion: '0',
      clientCapabilities: ['session.create'],
    });
    expect(result.compatible).toBe(false);
    expect(result.negotiatedCapabilities).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('below minimum');
  });

  it('protocol version newer than server → compatible with forward-compat warning', () => {
    const futureVersion = String(parseInt(AEGIS_PROTOCOL_VERSION, 10) + 5);
    const result = negotiate({ protocolVersion: futureVersion });
    expect(result.compatible).toBe(true);
    expect(result.warnings.some(w => w.includes('newer than server'))).toBe(true);
  });

  it('malformed protocolVersion → not compatible', () => {
    const result = negotiate({ protocolVersion: 'abc-bad' });
    expect(result.compatible).toBe(false);
    expect(result.warnings.some(w => w.includes('Unrecognized'))).toBe(true);
  });
});
