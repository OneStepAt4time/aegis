/** mcp/tools/session-tools.ts — 12 session lifecycle MCP tools. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AegisClient } from '../client.js';
import { withAuth, formatToolError } from '../auth.js';

export function registerSessionTools(server: McpServer, client: AegisClient): void {
  // ── list_sessions ──
  server.tool(
    'list_sessions',
    'List Aegis-managed Claude Code sessions. Optionally filter by status or workDir substring.',
    {
      status: z.string().optional().describe('Filter by status (e.g., idle, working, permission_prompt)'),
      workDir: z.string().optional().describe('Filter by workDir substring (e.g., "my-project")'),
    },
    withAuth('list_sessions', async ({ status, workDir }) => {
      try {
        const sessions = await client.listSessions({ status, workDir });
        const summary = sessions.map((s) => ({
          id: s.id,
          name: s.windowName,
          status: s.status,
          workDir: s.workDir,
          createdAt: new Date(s.createdAt).toISOString(),
          lastActivity: new Date(s.lastActivity).toISOString(),
        }));
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_status ──
  server.tool(
    'get_status',
    'Get detailed status and health of a specific Aegis session.',
    {
      sessionId: z.string().describe('The session ID to check'),
    },
    withAuth('get_status', async ({ sessionId }) => {
      try {
        const [session, health] = await Promise.all([
          client.getSession(sessionId),
          client.getHealth(sessionId).catch(() => null),
        ]);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ...session, health }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── get_transcript ──
  server.tool(
    'get_transcript',
    'Read the conversation transcript of another Aegis session. Returns recent messages from the JSONL log.',
    {
      sessionId: z.string().describe('The session ID to read from'),
    },
    withAuth('get_transcript', async ({ sessionId }) => {
      try {
        const transcript = await client.getTranscript(sessionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(transcript, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── send_message ──
  server.tool(
    'send_message',
    'Send a message to another Aegis session. The message is delivered via tmux send-keys with delivery verification. Returns stall information if the session is currently stalled.',
    {
      sessionId: z.string().describe('The target session ID'),
      text: z.string().describe('The message text to send'),
    },
    withAuth('send_message', async ({ sessionId, text }) => {
      try {
        const result = await client.sendMessage(sessionId, text);
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

  // ── create_session ──
  server.tool(
    'create_session',
    'Spawn a new Claude Code session managed by Aegis. Returns the session ID and initial status.',
    {
      workDir: z.string().describe('Working directory for the new session'),
      name: z.string().optional().describe('Optional human-readable name for the session'),
      prompt: z.string().optional().describe('Optional initial prompt to send after creation'),
    },
    withAuth('create_session', async ({ workDir, name, prompt }) => {
      try {
        const session = await client.createSession({ workDir, name, prompt });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              id: session.id,
              name: session.windowName,
              status: 'created',
              workDir: session.workDir,
              promptDelivery: session.promptDelivery,
            }, null, 2),
          }],
        };
      } catch (e: unknown) {
        return formatToolError(e);
      }
    }, client),
  );

  // ── kill_session ──
  server.tool(
    'kill_session',
    'Kill an Aegis session. Deletes the tmux window and cleans up all resources.',
    {
      sessionId: z.string().describe('The session ID to kill'),
    },
    withAuth('kill_session', async ({ sessionId }) => {
      try {
        const result = await client.killSession(sessionId);
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

  // ── approve_permission ──
  server.tool(
    'approve_permission',
    'Approve a pending permission prompt in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID with a pending permission prompt'),
    },
    withAuth('approve_permission', async ({ sessionId }) => {
      try {
        const result = await client.approvePermission(sessionId);
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

  // ── reject_permission ──
  server.tool(
    'reject_permission',
    'Reject a pending permission prompt in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID with a pending permission prompt'),
    },
    withAuth('reject_permission', async ({ sessionId }) => {
      try {
        const result = await client.rejectPermission(sessionId);
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

  // ── escape_session ──
  server.tool(
    'escape_session',
    'Send an Escape keypress to an Aegis session. Useful for dismissing prompts or cancelling operations.',
    {
      sessionId: z.string().describe('The session ID to send escape to'),
    },
    withAuth('escape_session', async ({ sessionId }) => {
      try {
        const result = await client.escapeSession(sessionId);
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

  // ── interrupt_session ──
  server.tool(
    'interrupt_session',
    'Send Ctrl+C to interrupt the current operation in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID to interrupt'),
    },
    withAuth('interrupt_session', async ({ sessionId }) => {
      try {
        const result = await client.interruptSession(sessionId);
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

  // ── send_bash ──
  server.tool(
    'send_bash',
    'Execute a bash command in an Aegis session. The command is prefixed with "!" and sent via tmux.',
    {
      sessionId: z.string().describe('The session ID to send the bash command to'),
      command: z.string().describe('The bash command to execute'),
    },
    withAuth('send_bash', async ({ sessionId, command }) => {
      try {
        const result = await client.sendBash(sessionId, command);
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

  // ── send_command ──
  server.tool(
    'send_command',
    'Send a slash command to an Aegis session. The command is prefixed with "/" if not already.',
    {
      sessionId: z.string().describe('The session ID to send the command to'),
      command: z.string().describe('The slash command to send (e.g., "help", "compact")'),
    },
    withAuth('send_command', async ({ sessionId, command }) => {
      try {
        const result = await client.sendCommand(sessionId, command);
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
