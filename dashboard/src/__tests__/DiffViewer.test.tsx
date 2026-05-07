/**
 * __tests__/DiffViewer.test.tsx — File diff viewer tests (#2906).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DiffViewer,
  parseFileChanges,
  computeDiff,
} from '../components/session/DiffViewer';
import type { ParsedEntry } from '../types';

function makeToolEntry(toolName: string, text: string): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'tool_use',
    toolName,
    text,
    toolUseId: `tool-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
}

describe('parseFileChanges', () => {
  it('returns empty array for no tool entries', () => {
    const entries: ParsedEntry[] = [
      { role: 'user', contentType: 'text', text: 'hello', timestamp: '' },
    ];
    expect(parseFileChanges(entries)).toHaveLength(0);
  });

  it('parses edit tool_use entries', () => {
    const entries = [
      makeToolEntry('edit', JSON.stringify({
        file_path: '/src/app.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
      })),
    ];
    const changes = parseFileChanges(entries);
    expect(changes).toHaveLength(1);
    expect(changes[0].filePath).toBe('/src/app.ts');
    expect(changes[0].type).toBe('edit');
    expect(changes[0].oldContent).toBe('const x = 1;');
    expect(changes[0].newContent).toBe('const x = 2;');
  });

  it('parses write tool_use entries', () => {
    const entries = [
      makeToolEntry('write', JSON.stringify({
        file_path: '/src/new-file.ts',
        content: 'export const hello = "world";',
      })),
    ];
    const changes = parseFileChanges(entries);
    expect(changes).toHaveLength(1);
    expect(changes[0].filePath).toBe('/src/new-file.ts');
    expect(changes[0].type).toBe('write');
    expect(changes[0].oldContent).toBeNull();
    expect(changes[0].newContent).toBe('export const hello = "world";');
  });

  it('ignores non-edit/write tools', () => {
    const entries = [
      makeToolEntry('bash', 'git status'),
      makeToolEntry('read', '/src/app.ts'),
    ];
    expect(parseFileChanges(entries)).toHaveLength(0);
  });

  it('ignores malformed JSON', () => {
    const entries = [
      makeToolEntry('edit', 'not valid json'),
    ];
    expect(parseFileChanges(entries)).toHaveLength(0);
  });

  it('parses multiple changes', () => {
    const entries = [
      makeToolEntry('edit', JSON.stringify({ file_path: '/a.ts', old_string: 'a', new_string: 'b' })),
      makeToolEntry('write', JSON.stringify({ file_path: '/b.ts', content: 'new' })),
      makeToolEntry('edit', JSON.stringify({ file_path: '/c.ts', old_string: 'c', new_string: 'd' })),
    ];
    const changes = parseFileChanges(entries);
    expect(changes).toHaveLength(3);
  });
});

describe('computeDiff', () => {
  it('marks all lines as add for new file', () => {
    const lines = computeDiff(null, 'line1\nline2\nline3');
    expect(lines).toHaveLength(3);
    expect(lines.every(l => l.type === 'add')).toBe(true);
  });

  it('shows context for unchanged lines', () => {
    const lines = computeDiff('same', 'same');
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('context');
  });

  it('shows remove+add for changed lines', () => {
    const lines = computeDiff('old', 'new');
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe('remove');
    expect(lines[0].content).toBe('old');
    expect(lines[1].type).toBe('add');
    expect(lines[1].content).toBe('new');
  });

  it('handles added lines', () => {
    const lines = computeDiff('a', 'a\nb');
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe('context');
    expect(lines[1].type).toBe('add');
    expect(lines[1].content).toBe('b');
  });

  it('handles removed lines', () => {
    const lines = computeDiff('a\nb', 'a');
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe('context');
    expect(lines[1].type).toBe('remove');
    expect(lines[1].content).toBe('b');
  });
});

describe('DiffViewer', () => {
  it('renders loading state', () => {
    render(<DiffViewer entries={[]} isLoading={true} />);
    expect(screen.getByText(/Scanning transcript/)).not.toBeNull();
  });

  it('renders empty state when no changes', () => {
    render(<DiffViewer entries={[]} isLoading={false} />);
    expect(screen.getByText(/No file changes detected/)).not.toBeNull();
  });

  it('renders file list when changes exist', () => {
    const entries = [
      makeToolEntry('edit', JSON.stringify({ file_path: '/src/app.ts', old_string: 'a', new_string: 'b' })),
      makeToolEntry('write', JSON.stringify({ file_path: '/src/new.ts', content: 'hello' })),
    ];
    render(<DiffViewer entries={entries} isLoading={false} />);
    expect(screen.getByText('app.ts')).not.toBeNull();
    expect(screen.getByText('new.ts')).not.toBeNull();
    expect(screen.getByText('2 files changed')).not.toBeNull();
  });

  it('shows diff content for selected file', () => {
    const entries = [
      makeToolEntry('edit', JSON.stringify({ file_path: '/src/app.ts', old_string: 'old line', new_string: 'new line' })),
    ];
    render(<DiffViewer entries={entries} isLoading={false} />);
    expect(screen.getByText('/src/app.ts')).not.toBeNull();
    expect(screen.getByText('modified')).not.toBeNull();
  });

  it('shows "created" badge for write operations', () => {
    const entries = [
      makeToolEntry('write', JSON.stringify({ file_path: '/src/new.ts', content: 'content' })),
    ];
    render(<DiffViewer entries={entries} isLoading={false} />);
    expect(screen.getByText('created')).not.toBeNull();
  });
});
