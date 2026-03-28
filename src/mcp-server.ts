/**
 * mcp-server.ts — MCP server mode for Aegis.
 *
 * Exposes Aegis session orchestration as MCP tools via stdio transport.
 * CC sessions can natively discover and communicate with sibling sessions.
 *
 * Usage:
 *   aegis-bridge mcp                    # default port 9100
 *   aegis-bridge mcp --port 3000        # custom port
 *   claude mcp add --scope user aegis -- npx aegis-bridge mcp
 *
 * Issue #48: https://github.com/OneStepAt4time/aegis/issues/48
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidUUID } from './validation.js';

// Read version from package.json at startup (matches cli.ts pattern)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
const VERSION: string = pkg.version;

// ── Aegis REST client ───────────────────────────────────────────────

export class AegisClient {
  constructor(private baseUrl: string, private authToken?: string) {}

  private validateSessionId(id: string): void {
    if (!isValidUUID(id)) {
      throw new Error(`Invalid session ID: ${id}`);
    }
  }

  private async request<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
    } catch (e: unknown) {
      const cause = (e as { cause?: { code?: string } }).cause;
      if (cause?.code === 'ECONNREFUSED') {
        throw new Error('Aegis server is not running or not reachable');
      }
      throw new Error(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async listSessions(filter?: { status?: string; workDir?: string }): Promise<any[]> {
    const response = await this.request<{ sessions: any[]; total: number }>('/v1/sessions');
    let sessions = response.sessions;
    if (filter?.status) {
      sessions = sessions.filter((s: any) => s.status === filter.status);
    }
    if (filter?.workDir) {
      sessions = sessions.filter((s: any) => s.workDir === filter.workDir || s.workDir?.startsWith(filter.workDir! + '/'));
    }
    return sessions;
  }

  async getSession(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}`);
  }

  async getHealth(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/health`);
  }

  async getTranscript(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/read`);
  }

  async sendMessage(id: string, text: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async createSession(opts: { workDir: string; name?: string; prompt?: string }): Promise<any> {
    return this.request('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  async killSession(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async approvePermission(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async rejectPermission(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  }

  async getServerHealth(): Promise<any> {
    return this.request('/v1/health');
  }

  async escapeSession(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/escape`, {
      method: 'POST',
    });
  }

  async interruptSession(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: 'POST',
    });
  }

  async capturePane(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/pane`);
  }

  async getSessionMetrics(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/metrics`);
  }

  async getSessionSummary(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/summary`);
  }

  async sendBash(id: string, command: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/bash`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async sendCommand(id: string, command: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async getSessionLatency(id: string): Promise<any> {
    this.validateSessionId(id);
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/latency`);
  }

  async batchCreateSessions(sessions: Array<{ workDir: string; name?: string; prompt?: string }>): Promise<any> {
    return this.request('/v1/sessions/batch', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    });
  }

  async listPipelines(): Promise<any> {
    return this.request('/v1/pipelines');
  }

  async createPipeline(config: { name: string; workDir: string; steps: any[] }): Promise<any> {
    return this.request('/v1/pipelines', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getSwarm(): Promise<any> {
    return this.request('/v1/swarm');
  }
}

// ── Error handling ──────────────────────────────────────────────────

interface McpErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

function formatToolError(e: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (e instanceof Error) {
    let code: string;
    if (e.message.includes('not running') || e.message.includes('not reachable') || e.message.includes('Network error')) {
      code = 'SERVER_UNREACHABLE';
    } else if (e.message.startsWith('Invalid session ID')) {
      code = 'INVALID_SESSION_ID';
    } else {
      code = 'REQUEST_FAILED';
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code, message: e.message } satisfies McpErrorEnvelope) }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ code: 'UNKNOWN_ERROR', message: String(e) } satisfies McpErrorEnvelope) }],
    isError: true,
  };
}

// ── MCP Server ──────────────────────────────────────────────────────

export function createMcpServer(aegisPort: number, authToken?: string): McpServer {
  const client = new AegisClient(`http://127.0.0.1:${aegisPort}`, authToken);

  const server = new McpServer(
    { name: 'aegis', version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ── MCP Resources (Issue #442) ────────────────────────────────────

  // aegis://sessions — compact session list
  server.resource(
    'sessions',
    'aegis://sessions',
    { description: 'List of active Aegis sessions (compact: id, name, status, workDir)', mimeType: 'application/json' },
    async (uri): Promise<ReadResourceResult> => {
      try {
        const sessions = await client.listSessions();
        const compact = sessions.map((s: Record<string, unknown>) => ({
          id: s.id,
          name: s.windowName,
          status: s.status,
          workDir: s.workDir,
        }));
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(compact, null, 2) }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${msg}` }],
        };
      }
    },
  );

  // aegis://sessions/{id}/transcript — full JSONL transcript
  server.resource(
    'session-transcript',
    new ResourceTemplate('aegis://sessions/{id}/transcript', { list: undefined }),
    { description: 'Full JSONL transcript of an Aegis session', mimeType: 'application/json' },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables.id as string;
      if (!isValidUUID(id)) {
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: Invalid session ID: ${id}` }],
        };
      }
      try {
        const transcript = await client.getTranscript(id);
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(transcript, null, 2) }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${msg}` }],
        };
      }
    },
  );

  // aegis://sessions/{id}/pane — current terminal pane content
  server.resource(
    'session-pane',
    new ResourceTemplate('aegis://sessions/{id}/pane', { list: undefined }),
    { description: 'Current terminal pane content of an Aegis session', mimeType: 'text/plain' },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = variables.id as string;
      if (!isValidUUID(id)) {
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: Invalid session ID: ${id}` }],
        };
      }
      try {
        const result = await client.capturePane(id);
        const text = typeof result.pane === 'string' ? result.pane : JSON.stringify(result, null, 2);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${msg}` }],
        };
      }
    },
  );

  // aegis://health — server health status
  server.resource(
    'health',
    'aegis://health',
    { description: 'Aegis server health status (version, uptime, session counts)', mimeType: 'application/json' },
    async (uri): Promise<ReadResourceResult> => {
      try {
        const health = await client.getServerHealth();
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(health, null, 2) }],
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${msg}` }],
        };
      }
    },
  );

  // ── list_sessions ──
  server.tool(
    'list_sessions',
    'List Aegis-managed Claude Code sessions. Optionally filter by status or workDir substring.',
    {
      status: z.string().optional().describe('Filter by status (e.g., idle, working, permission_prompt)'),
      workDir: z.string().optional().describe('Filter by workDir substring (e.g., "my-project")'),
    },
    async ({ status, workDir }) => {
      try {
        const sessions = await client.listSessions({ status, workDir });
        const summary = sessions.map((s: any) => ({
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
    },
  );

  // ── get_status ──
  server.tool(
    'get_status',
    'Get detailed status and health of a specific Aegis session.',
    {
      sessionId: z.string().describe('The session ID to check'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── get_transcript ──
  server.tool(
    'get_transcript',
    'Read the conversation transcript of another Aegis session. Returns recent messages from the JSONL log.',
    {
      sessionId: z.string().describe('The session ID to read from'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── send_message ──
  server.tool(
    'send_message',
    'Send a message to another Aegis session. The message is delivered via tmux send-keys with delivery verification.',
    {
      sessionId: z.string().describe('The target session ID'),
      text: z.string().describe('The message text to send'),
    },
    async ({ sessionId, text }) => {
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
    },
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
    async ({ workDir, name, prompt }) => {
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
    },
  );

  // ── kill_session ──
  server.tool(
    'kill_session',
    'Kill an Aegis session. Deletes the tmux window and cleans up all resources.',
    {
      sessionId: z.string().describe('The session ID to kill'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── approve_permission ──
  server.tool(
    'approve_permission',
    'Approve a pending permission prompt in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID with a pending permission prompt'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── reject_permission ──
  server.tool(
    'reject_permission',
    'Reject a pending permission prompt in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID with a pending permission prompt'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── server_health ──
  server.tool(
    'server_health',
    'Check the health and status of the Aegis server. Returns version, uptime, and session counts.',
    {},
    async () => {
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
    },
  );

  // ── escape_session ──
  server.tool(
    'escape_session',
    'Send an Escape keypress to an Aegis session. Useful for dismissing prompts or cancelling operations.',
    {
      sessionId: z.string().describe('The session ID to send escape to'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── interrupt_session ──
  server.tool(
    'interrupt_session',
    'Send Ctrl+C to interrupt the current operation in an Aegis session.',
    {
      sessionId: z.string().describe('The session ID to interrupt'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── capture_pane ──
  server.tool(
    'capture_pane',
    'Capture the raw terminal pane content of an Aegis session. Returns the current visible text.',
    {
      sessionId: z.string().describe('The session ID to capture'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── get_session_metrics ──
  server.tool(
    'get_session_metrics',
    'Get performance metrics for a specific Aegis session (message counts, latency, etc.).',
    {
      sessionId: z.string().describe('The session ID to get metrics for'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── get_session_summary ──
  server.tool(
    'get_session_summary',
    'Get a summary of an Aegis session including message counts, duration, and status history.',
    {
      sessionId: z.string().describe('The session ID to summarize'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── send_bash ──
  server.tool(
    'send_bash',
    'Execute a bash command in an Aegis session. The command is prefixed with "!" and sent via tmux.',
    {
      sessionId: z.string().describe('The session ID to send the bash command to'),
      command: z.string().describe('The bash command to execute'),
    },
    async ({ sessionId, command }) => {
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
    },
  );

  // ── send_command ──
  server.tool(
    'send_command',
    'Send a slash command to an Aegis session. The command is prefixed with "/" if not already.',
    {
      sessionId: z.string().describe('The session ID to send the command to'),
      command: z.string().describe('The slash command to send (e.g., "help", "compact")'),
    },
    async ({ sessionId, command }) => {
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
    },
  );

  // ── get_session_latency ──
  server.tool(
    'get_session_latency',
    'Get latency metrics for a specific Aegis session, including realtime and aggregated measurements.',
    {
      sessionId: z.string().describe('The session ID to get latency for'),
    },
    async ({ sessionId }) => {
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
    },
  );

  // ── batch_create_sessions ──
  server.tool(
    'batch_create_sessions',
    'Create multiple Aegis sessions in a single batch operation.',
    {
      sessions: z.array(z.object({
        workDir: z.string().describe('Working directory for the session'),
        name: z.string().optional().describe('Optional human-readable name'),
        prompt: z.string().optional().describe('Optional initial prompt'),
      })).describe('Array of session specifications to create'),
    },
    async ({ sessions: sessionSpecs }) => {
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
    },
  );

  // ── list_pipelines ──
  server.tool(
    'list_pipelines',
    'List all configured pipelines in the Aegis server.',
    {},
    async () => {
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
    },
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
      })).describe('Array of pipeline steps'),
    },
    async ({ name, workDir, steps }) => {
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
    },
  );

  // ── get_swarm ──
  server.tool(
    'get_swarm',
    'Get a snapshot of all Claude Code processes detected on the system (the "swarm").',
    {},
    async () => {
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
    },
  );

  // ── MCP Prompts (Issue #443) ────────────────────────────────────────

  server.prompt(
    'implement_issue',
    'Create a session and generate a structured implementation prompt for a GitHub issue.',
    {
      issueNumber: z.string().describe('GitHub issue number'),
      workDir: z.string().describe('Working directory for the new session'),
      repoOwner: z.string().optional().describe('Repository owner (e.g., "OneStepAt4time")'),
      repoName: z.string().optional().describe('Repository name (e.g., "aegis")'),
    },
    async ({ issueNumber, workDir, repoOwner, repoName }) => {
      const owner = repoOwner || 'OneStepAt4time';
      const repo = repoName || 'aegis';
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are tasked with implementing a GitHub issue.',
                '',
                `Issue: ${owner}/${repo}#${issueNumber}`,
                `URL: ${issueUrl}`,
                `Working directory: ${workDir}`,
                '',
                'Steps:',
                `1. Create a new Aegis session in ${workDir}`,
                `2. Read the GitHub issue at ${issueUrl} to understand the requirements`,
                '3. Analyze the codebase to understand the current architecture',
                '4. Plan the implementation approach',
                '5. Implement the changes following project conventions',
                '6. Run the quality gate: npx tsc --noEmit && npm run build && npm test',
                '7. If tests pass, commit with a conventional commit message',
                '',
                'Use the create_session tool to start, then send_message for each step.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'review_pr',
    'Create a session and generate a structured code review prompt for a GitHub pull request.',
    {
      prNumber: z.string().describe('GitHub pull request number'),
      workDir: z.string().describe('Working directory for the new session'),
      repoOwner: z.string().optional().describe('Repository owner (e.g., "OneStepAt4time")'),
      repoName: z.string().optional().describe('Repository name (e.g., "aegis")'),
    },
    async ({ prNumber, workDir, repoOwner, repoName }) => {
      const owner = repoOwner || 'OneStepAt4time';
      const repo = repoName || 'aegis';
      const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are tasked with reviewing a GitHub pull request.',
                '',
                `PR: ${owner}/${repo}#${prNumber}`,
                `URL: ${prUrl}`,
                `Working directory: ${workDir}`,
                '',
                'Steps:',
                `1. Create a new Aegis session in ${workDir}`,
                `2. Fetch the PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`,
                `3. Fetch the PR diff: gh pr diff ${prNumber} --repo ${owner}/${repo}`,
                '4. Review the changes for:',
                '   - Correctness and edge cases',
                '   - Adherence to project coding conventions (see CLAUDE.md)',
                '   - Security vulnerabilities (injection, XSS, etc.)',
                '   - Test coverage for new code',
                '   - Breaking changes or backwards compatibility',
                '5. Post the review as a PR comment using gh api',
                '',
                'Use the create_session tool to start, then send_message for each step.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'debug_session',
    'Generate a diagnostic summary for an Aegis session by reading its transcript and status.',
    {
      sessionId: z.string().describe('The Aegis session ID to debug'),
    },
    async ({ sessionId }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are diagnosing an Aegis session that may be stuck or misbehaving.',
                '',
                `Session ID: ${sessionId}`,
                '',
                'Steps:',
                `1. Get the session status using get_status for session ${sessionId}`,
                `2. Read the transcript using get_transcript for session ${sessionId}`,
                `3. Capture the current terminal pane using capture_pane for session ${sessionId}`,
                '4. Analyze the findings:',
                '   - Is the session in an unexpected state (permission_prompt, unknown)?',
                '   - Are there error messages in the transcript?',
                '   - Is the session stalled (no recent activity)?',
                '   - Are there repeated permission requests?',
                '5. Provide a diagnostic summary with recommended actions',
                '',
                'Use get_status, get_transcript, and capture_pane tools to gather data.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  return server;
}

// ── Main (stdio entrypoint) ─────────────────────────────────────────

export async function startMcpServer(port: number, authToken?: string): Promise<void> {
  const server = createMcpServer(port, authToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes
}
