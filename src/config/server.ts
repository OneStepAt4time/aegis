/**
 * config/server.ts — Zod schema for HTTP server config.
 *
 * Covers: port, host, baseUrl, SSE limits/timeouts, shutdown timing, dashboard toggle.
 */

import { z } from 'zod';

/** Zod schema for server config domain. */
export const serverConfigSchema = z.object({
  /** Preferred origin URL for API clients, hooks, and dashboard links. */
  baseUrl: z.string().optional().default(''),
  /** HTTP server port. */
  port: z.number().int().min(1).max(65535).default(9100),
  /** HTTP server host. */
  host: z.string().default('127.0.0.1'),
  /** Maximum total concurrent SSE connections (default: 100). */
  sseMaxConnections: z.number().int().positive().default(100),
  /** Maximum concurrent SSE connections per client IP (default: 10). */
  sseMaxPerIp: z.number().int().positive().default(10),
  /** Milliseconds of SSE silence before emitting a heartbeat ping. Default: 60000 (1 min). */
  sseIdleMs: z.number().int().min(1000).default(60_000),
  /** Milliseconds before closing an SSE connection that hasn't consumed data. Default: 300000 (5 min). */
  sseClientTimeoutMs: z.number().int().min(1000).default(300_000),
  /** Grace period in ms for in-flight requests during shutdown. Default: 15000 (15 s). */
  shutdownGraceMs: z.number().int().min(1000).default(15_000),
  /** Hard cap in ms for total shutdown sequence before process.exit. Default: 20000 (20 s). */
  shutdownHardMs: z.number().int().min(1000).default(20_000),
  /** Whether to serve the bundled dashboard. Default: true. */
  dashboardEnabled: z.boolean().optional().default(true),
});

/** Inferred type for the server config domain. */
export type ServerConfig = z.infer<typeof serverConfigSchema>;
