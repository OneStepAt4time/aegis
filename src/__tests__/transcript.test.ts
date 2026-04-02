import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNewEntries, parseEntries, type ParsedEntry } from '../transcript.js';

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
  is_error?: boolean;
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

  it('parses progress entries without message field', () => {
    const entries: JsonlEntry[] = [
      { type: 'progress', data: { percent: 50 }, timestamp: '2024-01-01T00:00:00Z' },
      {
        type: 'user',
        message: { role: 'user', content: 'Valid entry' },
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: 'system',
      contentType: 'progress',
    });
    expect(result[0].text).toContain('percent');
    expect(result[0].text).toContain('50');
    expect(result[1].text).toBe('Valid entry');
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

  // M16: permission_request contentType
  it('parses permission_request blocks as contentType permission_request', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'permission_request',
              text: 'Allow Bash: rm -rf /tmp/test',
            },
          ],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      contentType: 'permission_request',
      text: 'Allow Bash: rm -rf /tmp/test',
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  // M17: progress entries
  it('parses progress entries with various data shapes', () => {
    const entries: JsonlEntry[] = [
      { type: 'progress', data: { status: 'running', step: 3 }, timestamp: '2024-01-01T00:00:00Z' },
      { type: 'progress', data: { message: 'Installing dependencies...' }, timestamp: '2024-01-01T00:00:01Z' },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: 'system',
      contentType: 'progress',
      timestamp: '2024-01-01T00:00:00Z',
    });
    expect(result[0].text).toContain('running');
    expect(result[0].text).toContain('step');
    expect(result[1].text).toContain('Installing dependencies');
  });

  // M18: tool_result with is_error → tool_error
  it('sets contentType to tool_error when is_error is true', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'tool_result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Error: command not found',
              is_error: true,
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
      contentType: 'tool_error',
      toolUseId: 'tool-123',
      text: 'Error: command not found',
    });
  });

  it('sets contentType to tool_result when is_error is false', () => {
    const entries: JsonlEntry[] = [
      {
        type: 'tool_result',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-456',
              content: 'Success output',
              is_error: false,
            },
          ],
        },
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];

    const result = parseEntries(entries);

    expect(result).toHaveLength(1);
    expect(result[0].contentType).toBe('tool_result');
    expect(result[0].text).toBe('Success output');
  });
});

// Issue #259: readNewEntries should not drop entries when offset lands mid-line
describe('readNewEntries mid-offset', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-transcript-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-reads the partial line when offset lands mid-entry', async () => {
    const line1 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'First' }, timestamp: '2024-01-01T00:00:00Z' });
    const line2 = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Second' }, timestamp: '2024-01-01T00:00:01Z' });
    const content = `${line1}\n${line2}\n`;
    const filePath = join(tmpDir, 'test.jsonl');
    writeFileSync(filePath, content);

    // Set offset to the middle of line2
    const midLine2 = (line1.length + 1) + Math.floor(line2.length / 2);
    const result = await readNewEntries(filePath, midLine2);

    // Should still get line2 because we scan back to the previous newline
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('Second');
  });

  it('returns no entries when offset is at end of file', async () => {
    const line1 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Only' }, timestamp: '2024-01-01T00:00:00Z' });
    const content = `${line1}\n`;
    const filePath = join(tmpDir, 'test.jsonl');
    writeFileSync(filePath, content);

    const result = await readNewEntries(filePath, content.length);
    expect(result.entries).toHaveLength(0);
    expect(result.newOffset).toBe(content.length);
  });

  // Issue #409: async I/O should not block event loop
  it('uses async I/O and does not read the entire file', async () => {
    // Create a large file (>4096 bytes) to ensure the windowed scan
    // only reads a small portion, not the whole file
    const line1 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(5000) }, timestamp: '2024-01-01T00:00:00Z' });
    const line2 = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'y'.repeat(5000) }, timestamp: '2024-01-01T00:00:01Z' });
    const line3 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Target' }, timestamp: '2024-01-01T00:00:02Z' });
    const content = `${line1}\n${line2}\n${line3}\n`;
    const filePath = join(tmpDir, 'large.jsonl');
    writeFileSync(filePath, content);

    // Set offset to middle of line3 — should scan back to newline before line3
    const line3Start = line1.length + 1 + line2.length + 1;
    const midLine3 = line3Start + Math.floor(line3.length / 2);
    const result = await readNewEntries(filePath, midLine3);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('Target');
  });

  it('handles offset at start of file (no backward scan needed)', async () => {
    const line1 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'First' }, timestamp: '2024-01-01T00:00:00Z' });
    const content = `${line1}\n`;
    const filePath = join(tmpDir, 'start.jsonl');
    writeFileSync(filePath, content);

    const result = await readNewEntries(filePath, 0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('First');
  });

  it('scans across multiple newlines in the 4096-byte window', async () => {
    // Create lines small enough that multiple fit in the 4096-byte window
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `Line${i}` }, timestamp: '2024-01-01T00:00:00Z' }));
    }
    const content = lines.join('\n') + '\n';
    const filePath = join(tmpDir, 'multi.jsonl');
    writeFileSync(filePath, content);

    // Find offset for the middle of line 5
    let offset = 0;
    for (let i = 0; i < 5; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += Math.floor(lines[5].length / 2);

    const result = await readNewEntries(filePath, offset);
    // Should get lines 5-9 (scanning back finds newline before line 5)
    expect(result.entries.length).toBeGreaterThanOrEqual(4);
    expect(result.entries[0].text).toBe('Line5');
  });

  // Issue #579: backward scan falls back to offset 0 when no newline found
  it('falls back to offset 0 when no newline found in scan window', async () => {
    // Create a file where line1 is >4096 bytes (no newline within the 4096-byte scan window)
    const line1 = JSON.stringify({ type: 'user', message: { role: 'user', content: 'A'.repeat(6000) }, timestamp: '2024-01-01T00:00:00Z' });
    const line2 = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Target' }, timestamp: '2024-01-01T00:00:01Z' });
    const content = `${line1}\n${line2}\n`;
    const filePath = join(tmpDir, 'longline.jsonl');
    writeFileSync(filePath, content);

    // Set offset into line2 (past the 4096-byte scan window for line1)
    const midLine2 = line1.length + 1 + Math.floor(line2.length / 2);
    const result = await readNewEntries(filePath, midLine2);

    // Should fall back to offset 0 and include the Target entry (line2)
    // Without the fix, effectiveOffset would stay mid-line2, producing a corrupt parse
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries.some(e => e.text === 'Target')).toBe(true);
  });

  it('handles file truncation by resetting offset to 0', async () => {
    const content = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Only' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n';
    const filePath = join(tmpDir, 'truncated.jsonl');
    writeFileSync(filePath, content);

    // Offset larger than file size
    const result = await readNewEntries(filePath, 99999);
    expect(result.entries).toHaveLength(0);
    expect(result.newOffset).toBe(0);
  });
});

// Issue #823: parseLine should log when dropping malformed JSONL lines
describe('parseLine null logging (Issue #823)', () => {
  it('should log error when a line starts with { but has invalid JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const line = '{ invalid json }}}\n';
    const filePath = join(mkdtempSync(join(tmpdir(), 'aegis-parseline-')), 'bad.jsonl');
    writeFileSync(filePath, line);

    const result = await readNewEntries(filePath, 0);
    expect(result.entries).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('parseLine');
    expect(errorSpy.mock.calls[0][0]).toContain('malformed JSONL');

    errorSpy.mockRestore();
    rmSync(filePath, { recursive: true, force: true });
  });

  it('should not log for empty lines or lines not starting with {', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const content = '\n\n  \nsome plain text\n';
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'aegis-parseline-empty-'));
    const filePath = join(tmpDir2, 'empty.jsonl');
    writeFileSync(filePath, content);

    await readNewEntries(filePath, 0);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    rmSync(tmpDir2, { recursive: true, force: true });
  });
});
