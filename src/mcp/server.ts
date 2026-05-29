/**
 * mcp/server.ts — MCP server orchestrator.
 *
 * Creates the McpServer instance, wires up all modules (resources, tools, prompts),
 * and provides the stdio entrypoint.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AegisClient } from './client.js';
import type { IAegisBackend } from '../services/interfaces.js';
import { registerResources } from './resources.js';
import { registerSessionTools } from './tools/session-tools.js';
import { registerAcpTools } from './tools/acp-tools.js';
import { registerMonitoringTools } from './tools/monitoring-tools.js';
import { registerPipelineTools } from './tools/pipeline-tools.js';
import { registerManagementTools } from './tools/management-tools.js';
import { registerPrompts } from './prompts.js';

// Read version from package.json at startup (matches cli.ts pattern)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
const VERSION: string = pkg.version;

/** Create an MCP server wired to any IAegisBackend implementation. */
export function createMcpServerFromBackend(backend: IAegisBackend): McpServer {
  const server = new McpServer(
    { name: 'aegis', version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  registerResources(server, backend);
  registerSessionTools(server, backend);
  registerAcpTools(server, backend);
  registerMonitoringTools(server, backend);
  registerPipelineTools(server, backend);
  registerManagementTools(server, backend);
  registerPrompts(server);

  return server;
}

/** Create an MCP server using the remote HTTP client (backward-compatible). */
export function createMcpServer(aegisBaseUrlOrPort: number | string, authToken?: string): McpServer {
  const baseUrl = typeof aegisBaseUrlOrPort === 'number'
    ? `http://127.0.0.1:${aegisBaseUrlOrPort}`
    : aegisBaseUrlOrPort;
  const client = new AegisClient(baseUrl, authToken);
  return createMcpServerFromBackend(client);
}

/**
 * Redirect console.log to stderr in MCP stdio mode.
 *
 * The StdioServerTransport uses process.stdout for JSON-RPC messages.
 * Any console.log call (from Aegis code or transitive dependencies) would
 * inject non-protocol data into stdout, triggering the Claude Code memory
 * leak in versions before 2.1.132 (10GB+ RSS) or causing protocol parse errors.
 *
 * This defense-in-depth measure ensures that even if a console.log sneaks
 * into a shared code path, it goes to stderr instead of corrupting the
 * MCP transport channel.
 */
export function redirectConsoleLogToStderr(): void {
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };
}

/**
 * Attach JSON-RPC error response handling to the stdio transport.
 *
 * The MCP SDK's StdioServerTransport silently drops invalid messages:
 * parse errors and schema validation failures call onerror but never send
 * a JSON-RPC error response back to the client, leaving MCP clients hanging.
 *
 * This handler intercepts transport errors, classifies them, and sends proper
 * JSON-RPC error responses per the spec (-32700 Parse Error, -32600 Invalid Request).
 */
function attachStdioErrorHandler(transport: StdioServerTransport): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport.onerror = (error: Error) => {
    const msg = error?.message ?? String(error);
    let code: number;
    let message: string;

    if (msg.includes('Unexpected token') || msg.includes('JSON') || msg.includes('SyntaxError')) {
      code = -32700;
      message = 'Parse error';
    } else {
      code = -32600;
      message = 'Invalid Request';
    }

    const response = {
      jsonrpc: '2.0' as const,
      error: { code, message },
      id: null,
    };
    // Write directly to stdout — the transport is stdio-based
    process.stdout.write(JSON.stringify(response) + '\n');
  };
}

export async function startMcpServer(baseUrlOrPort: number | string, authToken?: string): Promise<void> {
  // Defense-in-depth: redirect console.log to stderr before connecting transport.
  // Prevents accidental non-protocol data from corrupting the MCP stdout channel.
  redirectConsoleLogToStderr();

  const server = createMcpServer(baseUrlOrPort, authToken);
  const transport = new StdioServerTransport();
  attachStdioErrorHandler(transport);
  await server.connect(transport);
  // Server runs until stdin closes
}
