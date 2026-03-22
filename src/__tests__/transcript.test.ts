import { describe, it, expect } from 'vitest';
import { parseEntries, type ParsedEntry } from '../transcript.js';

interface JsonlEntry {
  type: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    stop_reason?: string;
  };
  timestamp?: string;
  tool_use_id?: string;
  data?: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

describe('parseEntries', () => {
  it('returns empty array for empty input', () => {
    expect(parseEntries([])).toEqual([]);
  });

  it('parses simple text message with string content', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: 'Hello, world!',
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      contentType: 'text',
      text: 'Hello, world!',
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('parses text block from content array', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '  Response text  ' }],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'assistant',
      contentType: 'text',
      text: 'Response text',
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('parses thinking block', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '  Internal reasoning  ' }],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'assistant',
      contentType: 'thinking',
      text: 'Internal reasoning',
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('parses tool_use block with id', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              id: 'tool-123',
              input: { file_path: '/src/test.ts' },
            },
          ],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      contentType: 'tool_use',
      toolName: 'Read',
      toolUseId: 'tool-123',
    });
    expect(result[0].text).toContain('Read');
    expect(result[0].text).toContain('/src/test.ts');
  });

  it('parses tool_result with string content', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'tool_result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'File content here',
            },
          ],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      contentType: 'tool_result',
      toolUseId: 'tool-123',
      text: 'File content here',
    });
  });

  it('truncates long tool_result content', () => {
    const longContent = 'x'.repeat(600);
    const entries: JsonlEntry[] = [
      {
        type: 'tool_result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: longContent,
            },
          ],
        },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].text.length).toBeLessThan(520); // 500 + '... (truncated)'
    expect(result[0].text).toContain('truncated');
  });

  it('parses tool_result with array content', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'tool_result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-456',
              content: [
                { type: 'text', text: 'Line 1' },
                { type: 'text', text: 'Line 2' },
              ],
            },
          ],
        },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Line 1\nLine 2');
  });

  it('handles mixed content types', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think...' },
            { type: 'text', text: 'Here is my response' },
            {
              type: 'tool_use',
              name: 'Bash',
              id: 'tool-1',
              input: { command: 'ls -la' },
            },
          ],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(3);
    expect(result[0].contentType).toBe('thinking');
    expect(result[1].contentType).toBe('text');
    expect(result[2].contentType).toBe('tool_use');
    expect(result[2].toolName).toBe('Bash');
  });

  it('skips entries without message', () => {
    const entries: JsonlEntry[] = [
      { type: 'progress', data: { percent: 50 } },
      {
        type: 'user',
        message: { role: 'user', content: 'Valid entry' },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Valid entry');
  });

  it('skips empty text content', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: '   ',
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
        },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(0);
  });

  it('handles tool_use without id', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo test' },
            },
          ],
        },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('Bash');
    expect(result[0].toolUseId).toBeUndefined();
  });

  it('summarizes different tool types correctly', () => {
    const toolCases = [
      { name: 'Read', input: { file_path: '/src/a.ts' }, expectPath: '/src/a.ts' },
      { name: 'Write', input: { file_path: '/src/b.ts' }, expectPath: '/src/b.ts' },
      { name: 'Edit', input: { file_path: '/src/c.ts' }, expectPath: '/src/c.ts' },
      { name: 'Bash', input: { command: 'npm test' }, expectCmd: 'npm test' },
      { name: 'Grep', input: { pattern: 'TODO' }, expectPattern: 'TODO' },
      { name: 'Glob', input: { pattern: '*.ts' }, expectPattern: '*.ts' },
      { name: 'AskUserQuestion', input: { question: 'Proceed?' }, expectQ: 'Proceed?' },
      { name: 'TodoWrite', input: {}, expectText: 'Todo' },
      { name: 'UnknownTool', input: {}, expectText: 'UnknownTool' },
    ];

    for (const tc of toolCases) {
      const entries: JsonlEntry[] = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: tc.name, id: 'id', input: tc.input }],
          },
        },
      ];

      const result = parseEntries(entries);
      expect(result).toHaveLength(1);

      if (tc.expectPath) expect(result[0].text).toContain(tc.expectPath);
      if (tc.expectCmd) expect(result[0].text).toContain(tc.expectCmd);
      if (tc.expectPattern) expect(result[0].text).toContain(tc.expectPattern);
      if (tc.expectQ) expect(result[0].text).toContain(tc.expectQ);
      if (tc.expectText) expect(result[0].text).toContain(tc.expectText);
    }
  });
});
