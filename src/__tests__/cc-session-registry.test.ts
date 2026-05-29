/**
 * __tests__/cc-session-registry.test.ts — Tests for CC↔Aegis session mapping.
 * Issue #4455.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CcSessionRegistry } from '../services/cc-session-registry.js';

describe('CcSessionRegistry', () => {
  let registry: CcSessionRegistry;

  beforeEach(() => {
    registry = new CcSessionRegistry();
  });

  it('records and looks up a CC→Aegis mapping', () => {
    registry.record('cc-123', 'aegis-456');
    expect(registry.getAegisSessionId('cc-123')).toBe('aegis-456');
    expect(registry.getCcSessionId('aegis-456')).toBe('cc-123');
  });

  it('returns undefined for unknown IDs', () => {
    expect(registry.getAegisSessionId('cc-unknown')).toBeUndefined();
    expect(registry.getCcSessionId('aegis-unknown')).toBeUndefined();
  });

  it('overwrites previous mapping for the same CC session', () => {
    registry.record('cc-123', 'aegis-456');
    registry.record('cc-123', 'aegis-789');
    expect(registry.getAegisSessionId('cc-123')).toBe('aegis-789');
    expect(registry.getCcSessionId('aegis-789')).toBe('cc-123');
    // Old Aegis session should no longer be mapped
    expect(registry.getCcSessionId('aegis-456')).toBeUndefined();
  });

  it('overwrites previous mapping for the same Aegis session', () => {
    registry.record('cc-123', 'aegis-456');
    registry.record('cc-999', 'aegis-456');
    expect(registry.getCcSessionId('aegis-456')).toBe('cc-999');
    expect(registry.getAegisSessionId('cc-999')).toBe('aegis-456');
    // Old CC session should no longer be mapped
    expect(registry.getAegisSessionId('cc-123')).toBeUndefined();
  });

  it('removes mapping by Aegis session ID', () => {
    registry.record('cc-123', 'aegis-456');
    registry.removeByAegisSessionId('aegis-456');
    expect(registry.getAegisSessionId('cc-123')).toBeUndefined();
    expect(registry.getCcSessionId('aegis-456')).toBeUndefined();
  });

  it('no-ops when removing unknown Aegis session', () => {
    registry.record('cc-123', 'aegis-456');
    registry.removeByAegisSessionId('aegis-unknown');
    expect(registry.size).toBe(1);
  });

  it('returns all entries', () => {
    registry.record('cc-1', 'aegis-1');
    registry.record('cc-2', 'aegis-2');
    const entries = registry.entries();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.ccSessionId).sort()).toEqual(['cc-1', 'cc-2']);
  });

  it('tracks size correctly', () => {
    expect(registry.size).toBe(0);
    registry.record('cc-1', 'aegis-1');
    expect(registry.size).toBe(1);
    registry.record('cc-2', 'aegis-2');
    expect(registry.size).toBe(2);
    registry.removeByAegisSessionId('aegis-1');
    expect(registry.size).toBe(1);
  });
});
