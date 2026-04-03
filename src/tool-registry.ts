/**
 * tool-registry.ts — Tool usage tracking and registry for CC tool introspection.
 *
 * Parses tool_use messages from JSONL transcripts to build per-session
 * and global tool usage metrics. Exposes API endpoints for observability.
 *
 * Issue #704: Tool registry and schema validation for CC tool introspection.
 */

import { existsSync } from 'node:fs';
import type { SessionInfo } from './session.js';
import type { ParsedEntry } from './transcript.js';

/** Known CC tool definitions with metadata. */
export interface ToolDefinition {
  name: string;
  category: string;
  description: string;
  permissionLevel: string;
}

/** Per-tool usage stats within a session. */
export interface ToolUsageRecord {
  name: string;
  count: number;
  lastUsedAt: number;
  firstUsedAt: number;
  errors: number;
}

/** Tool registry: known tools + per-session usage tracking. */
export class ToolRegistry {
  private sessionUsage = new Map<string, Map<string, ToolUsageRecord>>();

  /** Built-in CC tool definitions (from CC src/tools/). */
  private readonly tools: ToolDefinition[] = [
    { name: 'Read', category: 'read', description: 'Read file contents', permissionLevel: 'read' },
    { name: 'Write', category: 'write', description: 'Write file contents', permissionLevel: 'write' },
    { name: 'Edit', category: 'edit', description: 'Edit file with search/replace', permissionLevel: 'edit' },
    { name: 'MultiEdit', category: 'edit', description: 'Multiple edits in one operation', permissionLevel: 'edit' },
    { name: 'Bash', category: 'bash', description: 'Execute shell commands', permissionLevel: 'bash' },
    { name: 'Glob', category: 'search', description: 'Find files matching pattern', permissionLevel: 'read' },
    { name: 'Grep', category: 'search', description: 'Search file contents', permissionLevel: 'read' },
    { name: 'ListFiles', category: 'search', description: 'List directory contents', permissionLevel: 'read' },
    { name: 'TodoWrite', category: 'edit', description: 'Update todo list', permissionLevel: 'edit' },
    { name: 'TodoRead', category: 'read', description: 'Read todo list', permissionLevel: 'read' },
    { name: 'WebFetch', category: 'read', description: 'Fetch web page content', permissionLevel: 'read' },
    { name: 'NotebookRead', category: 'read', description: 'Read notebook cells', permissionLevel: 'read' },
    { name: 'NotebookEdit', category: 'edit', description: 'Edit notebook cells', permissionLevel: 'edit' },
    { name: 'AskUserQuestion', category: 'agent', description: 'Ask user for clarification', permissionLevel: 'read' },
    { name: 'AgentTool', category: 'agent', description: 'Spawn sub-agent for parallel execution', permissionLevel: 'agent' },
    { name: 'MCPTool', category: 'mcp', description: 'MCP server tool invocation', permissionLevel: 'mcp' },
  ];

  /** Process parsed entries and extract tool usage. */
  processEntries(sessionId: string, entries: ParsedEntry[]): void {
    let usage = this.sessionUsage.get(sessionId);
    if (!usage) {
      usage = new Map();
      this.sessionUsage.set(sessionId, usage);
    }

    const now = Date.now();
    for (const entry of entries) {
      if (entry.contentType === 'tool_use' && entry.toolName) {
        const existing = usage.get(entry.toolName);
        if (existing) {
          existing.count++;
          existing.lastUsedAt = now;
        } else {
          usage.set(entry.toolName, {
            name: entry.toolName,
            count: 1,
            lastUsedAt: now,
            firstUsedAt: now,
            errors: 0,
          });
        }
      }
      if (entry.contentType === 'tool_error' && entry.toolName) {
        const existing = usage.get(entry.toolName);
        if (existing) {
          existing.errors++;
        }
      }
    }
  }

  /** Get tool usage for a session, sorted by count descending. */
  getSessionTools(sessionId: string): ToolUsageRecord[] {
    const usage = this.sessionUsage.get(sessionId);
    if (!usage) return [];
    return [...usage.values()].sort((a, b) => b.count - a.count);
  }

  /** Get all known CC tool definitions. */
  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools];
  }

  /** Get a tool definition by name. */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.tools.find(t => t.name === name);
  }

  /** Clean up session data. */
  cleanupSession(sessionId: string): void {
    this.sessionUsage.delete(sessionId);
  }
}
