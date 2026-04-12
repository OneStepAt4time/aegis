/**
 * mcp/tools/monitoring-tools.ts — Monitoring and observability MCP tools.
 *
 * 6 tools: server_health, capture_pane, get_session_metrics,
 * get_session_summary, get_session_latency, get_swarm.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { IAegisBackend } from '../../services/interfaces.js';
import { withAuth, formatToolError } from '../auth.js';

export function registerMonitoringTools(server: McpServer, client: IAegisBackend): void {
  // ── server_health ──
  server.tool(
    'server_health',
    'Check the health and status of the Aegis server. Returns version, uptime, and session counts.',
    {},
    withAuth('server_health', async () => {
      try {
        const result = await client.getServerHealth();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── capture_pane ──
  server.tool(
    'capture_pane',
    'Capture the raw terminal pane content of an Aegis session. Returns the current visible text.',
    {
      sessionId: z.string().describe('The session ID to capture'),
    },
    withAuth('capture_pane', async ({ sessionId }) => {
      try {
        const result = await client.capturePane(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_session_metrics ──
  server.tool(
    'get_session_metrics',
    'Get performance metrics for a specific Aegis session (message counts, latency, etc.).',
    {
      sessionId: z.string().describe('The session ID to get metrics for'),
    },
    withAuth('get_session_metrics', async ({ sessionId }) => {
      try {
        const result = await client.getSessionMetrics(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_session_summary ──
  server.tool(
    'get_session_summary',
    'Get a summary of an Aegis session including message counts, duration, and status history.',
    {
      sessionId: z.string().describe('The session ID to summarize'),
    },
    withAuth('get_session_summary', async ({ sessionId }) => {
      try {
        const result = await client.getSessionSummary(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_session_latency ──
  server.tool(
    'get_session_latency',
    'Get latency metrics for a specific Aegis session, including realtime and aggregated measurements.',
    {
      sessionId: z.string().describe('The session ID to get latency for'),
    },
    withAuth('get_session_latency', async ({ sessionId }) => {
      try {
        const result = await client.getSessionLatency(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_swarm ──
  server.tool(
    'get_swarm',
    'Get a snapshot of all Claude Code processes detected on the system (the "swarm").',
    {},
    withAuth('get_swarm', async () => {
      try {
        const result = await client.getSwarm();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );
}
