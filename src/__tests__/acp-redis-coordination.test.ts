import { describe, expect, it } from 'vitest';

import {
  ACP_REDIS_COORDINATION_RECOVERY_CONTRACT,
  AcpRedisCoordinationKeyError,
  createAcpRedisCoordinationKeys,
  normalizeAcpRedisCoordinationKeyPrefix,
  type AcpRealtimeDisconnectInput,
} from '../services/acp/index.js';

describe('ACP Redis coordination contracts', () => {
  it('builds ADR-0028 keys from the public Aegis session id', () => {
    const keys = createAcpRedisCoordinationKeys();

    expect(keys.presence('session-abc_123')).toBe('aegis:acp:presence:session-abc_123');
    expect(keys.driverLock('session-abc_123')).toBe(
      'aegis:acp:driver-lock:session-abc_123'
    );
    expect(keys.driverLockFence('session-abc_123')).toBe(
      'aegis:acp:driver-lock-fence:session-abc_123'
    );
    expect(keys.events('session-abc_123')).toBe('aegis:acp:events:session-abc_123');
    expect(keys.wakeups()).toBe('aegis:acp:actions:wakeup');
    expect(keys.subscriberState('session-abc_123', 'subscriber-1')).toBe(
      'aegis:acp:subscriber-state:session-abc_123:subscriber-1'
    );
  });

  it('normalizes safe custom prefixes before composing keys', () => {
    expect(normalizeAcpRedisCoordinationKeyPrefix('  team-a:aegis:  ')).toBe(
      'team-a:aegis'
    );

    const keys = createAcpRedisCoordinationKeys({ keyPrefix: '  team-a:aegis:  ' });

    expect(keys.presence('session-1')).toBe('team-a:aegis:acp:presence:session-1');
  });

  it('rejects blank or unsafe Redis key prefixes', () => {
    const unsafePrefixes = ['', '   ', 'aegis::prod', 'aegis prod', 'aegis/prod', 'aegis\nprod'];

    for (const prefix of unsafePrefixes) {
      expect(() => normalizeAcpRedisCoordinationKeyPrefix(prefix)).toThrow(
        AcpRedisCoordinationKeyError
      );
    }
  });

  it('rejects blank public session ids and ids containing Redis separators', () => {
    const keys = createAcpRedisCoordinationKeys();
    const unsafeSessionIds = ['', '   ', 'session:1', 'session 1', 'session\n1'];

    for (const sessionId of unsafeSessionIds) {
      expect(() => keys.presence(sessionId)).toThrow(AcpRedisCoordinationKeyError);
      expect(() => keys.driverLock(sessionId)).toThrow(AcpRedisCoordinationKeyError);
      expect(() => keys.events(sessionId)).toThrow(AcpRedisCoordinationKeyError);
    }
  });

  it('rejects blank or unsafe subscriber ids for subscriber state keys', () => {
    const keys = createAcpRedisCoordinationKeys();

    expect(() => keys.subscriberState('session-1', '')).toThrow(AcpRedisCoordinationKeyError);
    expect(() => keys.subscriberState('session-1', 'subscriber:1')).toThrow(
      AcpRedisCoordinationKeyError
    );
  });

  it('does not expose ACP agent or JSON-RPC id helper names', () => {
    const keys = createAcpRedisCoordinationKeys();
    const helperNames = Object.entries(keys)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);

    expect(helperNames.sort()).toEqual([
      'driverLock',
      'driverLockFence',
      'events',
      'presence',
      'subscriberState',
      'wakeups',
    ]);
    expect(helperNames.join('|')).not.toMatch(/acpAgent|jsonRpc|claudeSession|backendRun/i);
    expect(keys.driverLock('acp-agent-looking-id')).toBe(
      'aegis:acp:driver-lock:acp-agent-looking-id'
    );
    expect(keys.events('json-rpc-looking-id')).toBe(
      'aegis:acp:events:json-rpc-looking-id'
    );
  });

  it('documents Redis as volatile coordination recovered from durable stores', () => {
    expect(ACP_REDIS_COORDINATION_RECOVERY_CONTRACT.redisIsSourceOfTruth).toBe(false);
    expect(ACP_REDIS_COORDINATION_RECOVERY_CONTRACT.durableRecoverySources).toEqual([
      'postgres-event-replay',
      'postgres-action-queue',
    ]);
  });

  it('scopes disconnect driver-lock cleanup to the disconnecting session and subscriber', () => {
    const disconnect: AcpRealtimeDisconnectInput = {
      sessionId: 'session-1',
      subscriberId: 'subscriber-1',
      releaseDriverLock: {
        lockToken: 'lock-token-1',
        fencingToken: 7,
      },
    };

    expect(disconnect.releaseDriverLock).toEqual({
      lockToken: 'lock-token-1',
      fencingToken: 7,
    });

    const invalidDisconnect: AcpRealtimeDisconnectInput = {
      sessionId: 'session-1',
      subscriberId: 'subscriber-1',
      releaseDriverLock: {
        lockToken: 'lock-token-1',
        fencingToken: 7,
        // @ts-expect-error Disconnect cleanup must not target another session.
        sessionId: 'session-2',
      },
    };
    expect(invalidDisconnect.sessionId).toBe('session-1');
  });
});
