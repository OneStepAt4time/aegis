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
  registerMonitoringTools(server, backend);
  registerPipelineTools(server, backend);
  registerManagementTools(server, backend);
  registerPrompts(server);

  return server;
}

/** Create an MCP server using the remote HTTP client (backward-compatible). */
export function createMcpServer(aegisPort: number, authToken?: string): McpServer {
  const client = new AegisClient(`http://127.0.0.1:${aegisPort}`, authToken);
  return createMcpServerFromBackend(client);
}

export async function startMcpServer(port: number, authToken?: string): Promise<void> {
  const server = createMcpServer(port, authToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes
}
