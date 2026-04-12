/**
 * mcp-server.ts — Re-export facade for backward compatibility.
 *
 * The MCP server implementation lives in src/mcp/ modules.
 * This file re-exports the public API so existing consumers
 * (cli.ts, tests) continue to work without import changes.
 */

export { AegisClient } from './mcp/client.js';
export { EmbeddedBackend } from './mcp/embedded.js';
export { createMcpServer, createMcpServerFromBackend, startMcpServer } from './mcp/server.js';
export type { IAegisBackend } from './services/interfaces.js';
