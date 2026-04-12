/**
 * mcp/tools/pipeline-tools.ts — Pipeline and batch MCP tools.
 *
 * 3 tools: batch_create_sessions, list_pipelines, create_pipeline.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AegisClient } from '../client.js';
import { withAuth, formatToolError } from '../auth.js';

export function registerPipelineTools(server: McpServer, client: AegisClient): void {
  // ── batch_create_sessions ──
  server.tool(
    'batch_create_sessions',
    'Create multiple Aegis sessions in a single batch operation.',
    {
      sessions: z.array(z.object({
        workDir: z.string().describe('Working directory for the session'),
        name: z.string().optional().describe('Optional human-readable name'),
        prompt: z.string().optional().describe('Optional initial prompt'),
      })).min(1).max(50).describe('Array of session specifications to create (max 50)'),
    },
    withAuth('batch_create_sessions', async ({ sessions: sessionSpecs }) => {
      try {
        const result = await client.batchCreateSessions(sessionSpecs);
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

  // ── list_pipelines ──
  server.tool(
    'list_pipelines',
    'List all configured pipelines in the Aegis server.',
    {},
    withAuth('list_pipelines', async () => {
      try {
        const result = await client.listPipelines();
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

  // ── create_pipeline ──
  server.tool(
    'create_pipeline',
    'Create a new pipeline for orchestrating multiple Aegis sessions in sequence.',
    {
      name: z.string().describe('Name of the pipeline'),
      workDir: z.string().describe('Working directory for pipeline sessions'),
      steps: z.array(z.object({
        name: z.string().optional().describe('Step name'),
        prompt: z.string().describe('Prompt for this step'),
      })).min(1).max(50).describe('Array of pipeline steps (max 50)'),
    },
    withAuth('create_pipeline', async ({ name, workDir, steps }) => {
      try {
        const result = await client.createPipeline({ name, workDir, steps });
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
