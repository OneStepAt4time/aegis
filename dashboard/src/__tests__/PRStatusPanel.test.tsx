/**
 * __tests__/PRStatusPanel.test.tsx — CI/PR integration panel tests (#2907).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PRStatusPanel,
  parsePRFromTranscript,
} from '../components/session/PRStatusPanel';
import type { ParsedEntry } from '../types';

function makeBashEntry(text: string): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'tool_use',
    toolName: 'bash',
    text,
    timestamp: new Date().toISOString(),
  };
}

describe('parsePRFromTranscript', () => {
  it('returns nulls for empty transcript', () => {
    const result = parsePRFromTranscript([]);
    expect(result.prUrl).toBeNull();
    expect(result.branch).toBeNull();
  });

  it('extracts PR URL from gh pr create output', () => {
    const entries = [
      makeBashEntry('gh pr create --title "feat: add thing"\nhttps://github.com/org/repo/pull/42'),
    ];
    const result = parsePRFromTranscript(entries);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(result.prNumber).toBe(42);
    expect(result.repo).toBe('org/repo');
  });

  it('extracts branch from git push --set-upstream', () => {
    const entries = [
      makeBashEntry('git push --set-upstream origin feat/my-branch'),
    ];
    const result = parsePRFromTranscript(entries);
    expect(result.branch).toBe('feat/my-branch');
  });

  it('extracts branch from git push origin', () => {
    const entries = [
      makeBashEntry('git push origin fix/bug-123'),
    ];
    const result = parsePRFromTranscript(entries);
    expect(result.branch).toBe('fix/bug-123');
  });

  it('extracts both PR URL and branch from full workflow', () => {
    const entries = [
      makeBashEntry('git push --set-upstream origin feat/new-feature'),
      makeBashEntry('gh pr create --title "feat: new feature"\nhttps://github.com/OneStepAt4time/aegis/pull/123'),
    ];
    const result = parsePRFromTranscript(entries);
    expect(result.prUrl).toBe('https://github.com/OneStepAt4time/aegis/pull/123');
    expect(result.prNumber).toBe(123);
    expect(result.branch).toBe('feat/new-feature');
    expect(result.repo).toBe('OneStepAt4time/aegis');
  });

  it('ignores non-bash tool entries', () => {
    const entries: ParsedEntry[] = [
      { role: 'assistant', contentType: 'tool_use', toolName: 'edit', text: 'some file edit', timestamp: new Date().toISOString() },
    ];
    const result = parsePRFromTranscript(entries);
    expect(result.prUrl).toBeNull();
  });
});

describe('PRStatusPanel', () => {
  it('renders loading state', () => {
    render(<PRStatusPanel entries={[]} isLoading={true} />);
    expect(screen.getByText(/Scanning transcript/)).not.toBeNull();
  });

  it('renders empty state when no PR detected', () => {
    render(<PRStatusPanel entries={[]} isLoading={false} />);
    expect(screen.getByText(/No pull request detected/)).not.toBeNull();
  });

  it('renders PR link when PR detected', () => {
    const entries = [
      makeBashEntry('gh pr create\nhttps://github.com/org/repo/pull/7'),
    ];
    render(<PRStatusPanel entries={entries} isLoading={false} />);
    expect(screen.getByText('org/repo#7')).not.toBeNull();
  });

  it('renders branch name', () => {
    const entries = [
      makeBashEntry('git push origin feat/cool-thing'),
    ];
    render(<PRStatusPanel entries={entries} isLoading={false} />);
    expect(screen.getByText('feat/cool-thing')).not.toBeNull();
  });
});
