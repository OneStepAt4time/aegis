import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import type { ParsedEntry } from '../transcript.js';

function makeToolUse(toolName: string): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'tool_use',
    text: `Used ${toolName}`,
    toolName,
  };
}

function makeToolError(toolName: string): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'tool_error',
    text: `Error from ${toolName}`,
    toolName,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new ToolRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the built-in tool definitions as a defensive copy', () => {
    const definitions = registry.getToolDefinitions();

    expect(definitions).toHaveLength(16);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Read', category: 'read', permissionLevel: 'read' }),
        expect.objectContaining({ name: 'Write', category: 'write', permissionLevel: 'write' }),
        expect.objectContaining({ name: 'Edit', category: 'edit', permissionLevel: 'edit' }),
        expect.objectContaining({ name: 'Bash', category: 'bash', permissionLevel: 'bash' }),
        expect.objectContaining({ name: 'MCPTool', category: 'mcp', permissionLevel: 'mcp' }),
      ]),
    );

    definitions.pop();
    expect(registry.getToolDefinitions()).toHaveLength(16);
  });

  it('tracks tool usage and errors for a new session', () => {
    vi.setSystemTime(1_000);

    registry.processEntries('session-1', [
      makeToolUse('Read'),
      makeToolUse('Read'),
      makeToolUse('Bash'),
      makeToolError('Read'),
      makeToolError('UnknownTool'),
    ]);

    expect(registry.getSessionTools('session-1')).toEqual([
      {
        name: 'Read',
        count: 2,
        firstUsedAt: 1_000,
        lastUsedAt: 1_000,
        errors: 1,
      },
      {
        name: 'Bash',
        count: 1,
        firstUsedAt: 1_000,
        lastUsedAt: 1_000,
        errors: 0,
      },
    ]);
  });

  it('accumulates usage across processEntries calls and updates lastUsedAt only', () => {
    vi.setSystemTime(1_000);
    registry.processEntries('session-1', [makeToolUse('Read')]);

    vi.setSystemTime(2_500);
    registry.processEntries('session-1', [makeToolUse('Read'), makeToolError('Read')]);

    expect(registry.getSessionTools('session-1')).toEqual([
      {
        name: 'Read',
        count: 2,
        firstUsedAt: 1_000,
        lastUsedAt: 2_500,
        errors: 1,
      },
    ]);
  });

  it('sorts session tools by descending usage count', () => {
    vi.setSystemTime(1_000);
    registry.processEntries('session-1', [
      makeToolUse('Bash'),
      makeToolUse('Read'),
      makeToolUse('Read'),
      makeToolUse('Edit'),
      makeToolUse('Edit'),
      makeToolUse('Edit'),
    ]);

    expect(registry.getSessionTools('session-1').map(tool => tool.name)).toEqual(['Edit', 'Read', 'Bash']);
  });

  it('returns an empty list for unknown sessions', () => {
    expect(registry.getSessionTools('missing-session')).toEqual([]);
  });

  it('cleans up one session without affecting others', () => {
    vi.setSystemTime(1_000);
    registry.processEntries('session-1', [makeToolUse('Read')]);
    registry.processEntries('session-2', [makeToolUse('Bash')]);

    registry.cleanupSession('session-1');

    expect(registry.getSessionTools('session-1')).toEqual([]);
    expect(registry.getSessionTools('session-2')).toEqual([
      {
        name: 'Bash',
        count: 1,
        firstUsedAt: 1_000,
        lastUsedAt: 1_000,
        errors: 0,
      },
    ]);
  });

  it('looks up tool definitions by exact name', () => {
    expect(registry.getToolDefinition('Read')).toEqual({
      name: 'Read',
      category: 'read',
      description: 'Read file contents',
      permissionLevel: 'read',
    });
    expect(registry.getToolDefinition('read')).toBeUndefined();
    expect(registry.getToolDefinition('NotATool')).toBeUndefined();
  });
});