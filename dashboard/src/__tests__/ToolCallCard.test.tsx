/**
 * __tests__/ToolCallCard.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCard } from '../components/session/ToolCallCard';
import type { AcpToolCall } from '../types/acp-chat';

const completedTool: AcpToolCall = {
  id: 'tc-1',
  toolName: 'bash',
  input: { command: 'ls -la' },
  status: 'completed',
  result: {
    output: 'total 64\ndrwxr-xr-x',
    durationMs: 150,
    diffs: [
      {
        filePath: 'src/index.ts',
        diff: '@@ -1,3 +1,4 @@\n import { a } from "./b";\n+import { c } from "./d";\n export const x = 1;',
        additions: 1,
        deletions: 0,
      },
    ],
  },
};

const runningTool: AcpToolCall = {
  id: 'tc-2',
  toolName: 'edit_file',
  status: 'running',
};

const failedTool: AcpToolCall = {
  id: 'tc-3',
  toolName: 'bash',
  input: { command: 'rm -rf /' },
  status: 'failed',
  result: { error: 'Permission denied' },
};

const pendingTool: AcpToolCall = {
  id: 'tc-4',
  toolName: 'search',
  status: 'pending',
};

const cancelledTool: AcpToolCall = {
  id: 'tc-5',
  toolName: 'write_file',
  status: 'cancelled',
};

describe('ToolCallCard', () => {
  it('renders tool name', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('renders status label', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    expect(screen.getByText('Completed')).toBeDefined();
  });

  it('renders duration when available', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    // Duration is in a span within the header
    const article = screen.getByRole('article');
    expect(article.textContent).toContain('0.1s');
  });

  it('shows running spinner', () => {
    render(<ToolCallCard toolCall={runningTool} />);
    expect(screen.getByText('Running')).toBeDefined();
  });

  it('shows failed status', () => {
    render(<ToolCallCard toolCall={failedTool} />);
    expect(screen.getByText('Failed')).toBeDefined();
  });

  it('shows error message for failed tool', () => {
    render(<ToolCallCard toolCall={failedTool} />);
    expect(screen.getByText('Permission denied')).toBeDefined();
  });

  it('shows pending status', () => {
    render(<ToolCallCard toolCall={pendingTool} />);
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('shows cancelled status', () => {
    render(<ToolCallCard toolCall={cancelledTool} />);
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('has article role with tool name in aria-label', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    expect(screen.getByRole('article').getAttribute('aria-label')).toBe('Tool call: bash');
  });

  it('toggles input preview', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    fireEvent.click(screen.getByText('Input'));
    expect(screen.getByText(/ls -la/)).toBeDefined();
  });

  it('shows input expanded by default when showInput is true', () => {
    render(<ToolCallCard toolCall={completedTool} showInput={true} />);
    expect(screen.getByText(/ls -la/)).toBeDefined();
  });

  it('toggles output preview', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    fireEvent.click(screen.getByText('Output'));
    expect(screen.getByText(/total 64/)).toBeDefined();
  });

  it('renders file diff count', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    expect(screen.getByText('1 file changed')).toBeDefined();
  });

  it('toggles file diff expansion', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    // The diff path is shown
    expect(screen.getByText('src/index.ts')).toBeDefined();
  });

  it('shows diff additions and deletions', () => {
    render(<ToolCallCard toolCall={completedTool} />);
    expect(screen.getByText('+1')).toBeDefined();
    expect(screen.getByText('-0')).toBeDefined();
  });

  it('renders tool without input or result', () => {
    render(<ToolCallCard toolCall={runningTool} />);
    expect(screen.getByText('edit_file')).toBeDefined();
    expect(screen.queryByText('Input')).toBeNull();
    expect(screen.queryByText('Output')).toBeNull();
  });

  it('does not show output toggle when no output', () => {
    render(<ToolCallCard toolCall={failedTool} />);
    expect(screen.queryByText('Output')).toBeNull();
  });

  it('does not show diff section when no diffs', () => {
    render(<ToolCallCard toolCall={failedTool} />);
    expect(screen.queryByText('file changed')).toBeNull();
  });
});
