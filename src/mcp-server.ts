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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isValidUUID } from './validation.js';

const VERSION = '1.2.0';

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
    const res = await fetch(`${this.baseUrl}${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as any).error || `HTTP ${res.status}`);
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
}

// ── MCP Server ──────────────────────────────────────────────────────

export function createMcpServer(aegisPort: number, authToken?: string): McpServer {
  const client = new AegisClient(`http://127.0.0.1:${aegisPort}`, authToken);

  const server = new McpServer(
    { name: 'aegis', version: VERSION },
    { capabilities: { tools: {} } },
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
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
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
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
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
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
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
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
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
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
      }
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
