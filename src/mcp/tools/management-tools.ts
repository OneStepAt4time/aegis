/**
 * mcp/tools/management-tools.ts — State management MCP tools.
 *
 * 3 tools: state_set, state_get, state_delete.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AegisClient } from '../client.js';
import { withAuth, formatToolError } from '../auth.js';

export function registerManagementTools(server: McpServer, client: AegisClient): void {
  // ── state_set ──
  server.tool(
    'state_set',
    'Set a shared state key/value entry via Aegis memory bridge.',
    {
      key: z.string().describe('State key in namespace/key format (e.g., pipeline/run-123)'),
      value: z.string().describe('State payload as string'),
      ttlSeconds: z.number().int().positive().max(86400 * 30).optional().describe('Optional TTL in seconds (max 30 days)'),
    },
    withAuth('state_set', async ({ key, value, ttlSeconds }) => {
      try {
        const result = await client.setMemory(key, value, ttlSeconds);
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

  // ── state_get ──
  server.tool(
    'state_get',
    'Get a shared state key/value entry via Aegis memory bridge.',
    {
      key: z.string().describe('State key in namespace/key format (e.g., pipeline/run-123)'),
    },
    withAuth('state_get', async ({ key }) => {
      try {
        const result = await client.getMemory(key);
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

  // ── state_delete ──
  server.tool(
    'state_delete',
    'Delete a shared state key/value entry via Aegis memory bridge.',
    {
      key: z.string().describe('State key in namespace/key format (e.g., pipeline/run-123)'),
    },
    withAuth('state_delete', async ({ key }) => {
      try {
        const result = await client.deleteMemory(key);
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
