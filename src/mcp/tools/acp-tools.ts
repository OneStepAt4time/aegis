/** mcp/tools/acp-tools.ts — ACP-native MCP tools for session control and interaction.
 *
 * These tools provide ACP-native semantics for:
 * - Prompt submission via ACP action queue
 * - Event subscription and retrieval
 * - Chat history access
 * - Approval responses with ACP contracts
 * - Driver and observer role management
 * - Pause/resume/cancel session control
 * - Timeline and terminal debug access
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { IAegisBackend } from '../../services/interfaces.js';
import { withAuth, formatToolError } from '../auth.js';

export function registerAcpTools(server: McpServer, client: IAegisBackend): void {
  // ── acp_send_prompt ──
  // Send a prompt to an ACP-managed session via the action queue.
  // Replaces send_message with ACP-native semantics.
  server.tool(
    'acp_send_prompt',
    'Send a prompt to an Aegis session managed by ACP. The prompt is queued as an action and delivered to the Claude Code session.',
    {
      sessionId: z.string().describe('The session ID to send the prompt to'),
      prompt: z.string().describe('The prompt text to send'),
    },
    withAuth('acp_send_prompt', async ({ sessionId, prompt }) => {
      try {
        // Forward to existing sendMessage endpoint for now
        // After ACP-061 is merged, this will route to new acp_send_prompt endpoint
        const result = await client.sendMessage(sessionId, prompt);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ...result,
              actionType: 'prompt.send',
              queued: true,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_respond_approval ──
  // Respond to a pending approval request in an ACP session.
  // Combines approve_permission and reject_permission with explicit response semantics.
  server.tool(
    'acp_respond_approval',
    'Respond to a pending approval request in an Aegis session. Requires an explicit approve or reject decision.',
    {
      sessionId: z.string().describe('The session ID with a pending approval request'),
      approved: z.boolean().describe('true to approve, false to reject'),
      reason: z.string().optional().describe('Optional reason for rejection or override'),
    },
    withAuth('acp_respond_approval', async ({ sessionId, approved, reason }) => {
      try {
        const result = approved
          ? await client.approvePermission(sessionId)
          : await client.rejectPermission(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ...result,
              approved,
              reason: reason || undefined,
              actionType: 'approval.respond',
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_pause_session ──
  // Pause an active session (placeholder for ACP-064 control action endpoint).
  server.tool(
    'acp_pause_session',
    'Pause an active session. Queues actions are held; event ingestion continues. Requires ACP-064 endpoint.',
    {
      sessionId: z.string().describe('The session ID to pause'),
      reason: z.string().optional().describe('Optional reason for pause'),
    },
    withAuth('acp_pause_session', async ({ sessionId, reason }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/pause endpoint
        // For now, return a structure indicating this is not yet implemented
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'session.pause',
              status: 'not_implemented',
              message: 'acp_pause_session requires ACP-064 control action endpoint',
              reason: reason || undefined,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_resume_session ──
  // Resume a paused session (placeholder for ACP-064 control action endpoint).
  server.tool(
    'acp_resume_session',
    'Resume a paused session. Queued actions resume delivery. Requires ACP-064 endpoint.',
    {
      sessionId: z.string().describe('The session ID to resume'),
    },
    withAuth('acp_resume_session', async ({ sessionId }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/resume endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'session.resume',
              status: 'not_implemented',
              message: 'acp_resume_session requires ACP-064 control action endpoint',
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_cancel_session ──
  // Cancel a running session (placeholder for ACP-064 control action endpoint).
  server.tool(
    'acp_cancel_session',
    'Cancel a running session. Requests graceful termination or hard kill based on ACP capability.',
    {
      sessionId: z.string().describe('The session ID to cancel'),
      force: z.boolean().optional().describe('true for hard kill, false for graceful cancel'),
    },
    withAuth('acp_cancel_session', async ({ sessionId, force }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/cancel endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'session.cancel',
              status: 'not_implemented',
              message: 'acp_cancel_session requires ACP-064 control action endpoint',
              force: force || false,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_claim_driver ──
  // Claim driver role for exclusive prompt submission (placeholder for ACP-064).
  server.tool(
    'acp_claim_driver',
    'Claim the driver role for exclusive prompt submission to a session.',
    {
      sessionId: z.string().describe('The session ID to claim driver for'),
      ttlSeconds: z.number().int().positive().optional().describe('Driver claim TTL in seconds'),
    },
    withAuth('acp_claim_driver', async ({ sessionId, ttlSeconds }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/driver/claim endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'driver.claim',
              status: 'not_implemented',
              message: 'acp_claim_driver requires ACP-064 control action endpoint',
              ttlSeconds: ttlSeconds || undefined,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_release_driver ──
  // Release the driver role (placeholder for ACP-064).
  server.tool(
    'acp_release_driver',
    'Release the driver role for a session.',
    {
      sessionId: z.string().describe('The session ID to release driver for'),
    },
    withAuth('acp_release_driver', async ({ sessionId }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/driver/release endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'driver.release',
              status: 'not_implemented',
              message: 'acp_release_driver requires ACP-064 control action endpoint',
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_transfer_driver ──
  // Transfer driver role to another key/user (placeholder for ACP-064).
  server.tool(
    'acp_transfer_driver',
    'Transfer the driver role to another authenticated user or key.',
    {
      sessionId: z.string().describe('The session ID to transfer driver for'),
      targetKeyId: z.string().describe('The target API key ID to transfer driver to'),
    },
    withAuth('acp_transfer_driver', async ({ sessionId, targetKeyId }) => {
      try {
        // Placeholder for ACP-064 /v1/sessions/:id/driver/transfer endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              actionType: 'driver.transfer',
              status: 'not_implemented',
              message: 'acp_transfer_driver requires ACP-064 control action endpoint',
              targetKeyId,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_get_events ──
  // Retrieve events from session event store (placeholder for ACP-063 event replay).
  server.tool(
    'acp_get_events',
    'Get events from a session event store. Returns normalized ACP domain events.',
    {
      sessionId: z.string().describe('The session ID to retrieve events from'),
      since: z.number().optional().describe('Optional event ID to start from'),
      limit: z.number().int().positive().optional().describe('Maximum events to return (default 50)'),
    },
    withAuth('acp_get_events', async ({ sessionId, since, limit }) => {
      try {
        // Placeholder for ACP-063 /v1/sessions/:id/events endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              status: 'not_implemented',
              message: 'acp_get_events requires ACP-063 event replay endpoint',
              since: since || 0,
              limit: limit || 50,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_get_chat ──
  // Get chat history and snapshots (placeholder for ACP-063).
  server.tool(
    'acp_get_chat',
    'Get chat history for a session. Returns turns, messages, tool calls, and results.',
    {
      sessionId: z.string().describe('The session ID to retrieve chat from'),
      offset: z.number().int().optional().describe('Pagination offset'),
      limit: z.number().int().positive().optional().describe('Maximum messages to return'),
    },
    withAuth('acp_get_chat', async ({ sessionId, offset, limit }) => {
      try {
        // Placeholder for ACP-063 /v1/sessions/:id/chat endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              status: 'not_implemented',
              message: 'acp_get_chat requires ACP-063 event replay endpoint with chat view',
              offset: offset || 0,
              limit: limit || 50,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_get_timeline ──
  // Get timeline of operator actions and state changes (placeholder for ACP-063).
  server.tool(
    'acp_get_timeline',
    'Get the operator timeline for a session. Shows driver changes, pause/resume, interventions, and errors.',
    {
      sessionId: z.string().describe('The session ID to retrieve timeline from'),
      offset: z.number().int().optional().describe('Pagination offset'),
      limit: z.number().int().positive().optional().describe('Maximum events to return'),
    },
    withAuth('acp_get_timeline', async ({ sessionId, offset, limit }) => {
      try {
        // Placeholder for ACP-063 /v1/sessions/:id/timeline endpoint
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              status: 'not_implemented',
              message: 'acp_get_timeline requires ACP-063 event replay endpoint with timeline view',
              offset: offset || 0,
              limit: limit || 50,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── acp_get_terminal_debug ──
  // Get terminal output for debugging (replaces capture_pane with ACP-native semantics).
  server.tool(
    'acp_get_terminal_debug',
    'Get terminal output and debug information from a session. For debugging only, not a control surface.',
    {
      sessionId: z.string().describe('The session ID to get terminal output from'),
      maxLines: z.number().int().positive().optional().describe('Maximum lines to return'),
    },
    withAuth('acp_get_terminal_debug', async ({ sessionId, maxLines }) => {
      try {
        // For now, try to use the capture pane endpoint if available
        // After ACP cutover, this will map to ACP terminal extension output
        try {
          const paneResult = await client.capturePane(sessionId);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                terminal: paneResult.pane,
                diagnostic: true,
                note: 'Terminal output is diagnostic and read-only. Use chat view for interaction.',
                maxLines: maxLines || -1,
              }, null, 2),
            }],
          };
        } catch {
          // If capturePane is not available, return placeholder
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                ok: false,
                status: 'not_implemented',
                message: 'acp_get_terminal_debug requires ACP terminal extension output',
                maxLines: maxLines || -1,
              }, null, 2),
            }],
          };
        }
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );
}
