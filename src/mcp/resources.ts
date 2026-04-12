/**
 * mcp/resources.ts — MCP resource registrations.
 *
 * Exposes Aegis data as MCP resources (sessions list, transcript, pane, health).
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { isValidUUID } from '../validation.js';
import type { IAegisBackend } from '../services/interfaces.js';

export function registerResources(server: McpServer, client: IAegisBackend): void {
  // aegis://sessions — compact session list
  server.resource(
    'sessions',
    'aegis://sessions',
    { description: 'List of active Aegis sessions (compact: id, name, status, workDir)', mimeType: 'application/json' },
    async (uri): Promise<ReadResourceResult> => {
      try {
        const sessions = await client.listSessions();
        const compact = sessions.map((s) => ({
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
}
