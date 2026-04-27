/**
 * store-factory.ts — Factory for creating StateStore instances based on config.
 *
 * Issue #1937: Pluggable SessionStore interface.
 */

import type { Config } from '../../config.js';
import type { StateStore } from './state-store.js';
import type { RedisClient } from './RedisStateStore.js';
import { JsonFileStore } from './JsonFileStore.js';
import { PostgresStore } from './PostgresStore.js';

/**
 * Create a StateStore instance based on the configured backend.
 *
 * Supported backends: 'file' (default), 'redis', 'postgres'.
 * Selection via `AEGIS_SESSION_STORE` env var or `stateStore` config field.
 */
export async function createStateStore(config: Config): Promise<StateStore> {
  const backend = config.stateStore;

  switch (backend) {
    case 'file':
    case '':
      return new JsonFileStore({ stateDir: config.stateDir });

    case 'postgres': {
      if (!config.postgresUrl) {
        throw new Error(
          'PostgresStore requires AEGIS_POSTGRES_URL to be set when AEGIS_SESSION_STORE=postgres',
        );
      }
      return new PostgresStore({
        url: config.postgresUrl,
        tableName: process.env['AEGIS_PG_TABLE'],
        schemaName: process.env['AEGIS_PG_SCHEMA'],
        poolMax: process.env['AEGIS_PG_POOL_MAX']
          ? parseInt(process.env['AEGIS_PG_POOL_MAX'], 10)
          : undefined,
      });
    }

    case 'redis': {
      // Lazy-import to avoid requiring ioredis when not using Redis.
      const { RedisStateStore } = await import('./RedisStateStore.js');
      const ioredis = await import('ioredis');
      const url = process.env['AEGIS_REDIS_URL'] ?? 'redis://localhost:6379';
      // ioredis's default export is the Redis constructor at runtime, but its
      // TypeScript declarations lack a construct signature on the default export.
      const RedisCtor = ioredis.default as unknown as new (url: string) => RedisClient;
      const client = new RedisCtor(url);
      return new RedisStateStore(client, {
        url,
        keyPrefix: process.env['AEGIS_REDIS_KEY_PREFIX'] ?? 'aegis',
      });
    }

    default:
      throw new Error(
        `Unknown state store backend: '${backend}'. Supported: file, redis, postgres`,
      );
  }
}
