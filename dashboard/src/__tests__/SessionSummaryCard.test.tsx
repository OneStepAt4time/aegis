import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionSummaryCard } from '../components/session/SessionSummaryCard';
import type { SessionSummary } from '../types';

const BASE_SUMMARY: SessionSummary = {
  sessionId: 'sess-1',
  windowName: 'Test Session',
  status: 'idle',
  totalMessages: 5,
  messages: [
    { role: 'user', contentType: 'text', text: 'Hello' },
    { role: 'user', contentType: 'text', text: 'World' },
    { role: 'assistant', contentType: 'text', text: 'Hi there' },
    { role: 'assistant', contentType: 'text', text: 'How are you?' },
    { role: 'tool', contentType: 'tool_result', text: 'result' },
  ],
  createdAt: Date.now() - 65_000, // ~1 minute ago
  lastActivity: Date.now() - 10_000,
  permissionMode: 'default',
};

describe('SessionSummaryCard', () => {
  it('renders the loading state', () => {
    render(<SessionSummaryCard summary={null} loading={true} />);
    expect(screen.getByText('Loading summary\u2026')).toBeDefined();
  });

  it('renders nothing when summary is null and not loading', () => {
    const { container } = render(<SessionSummaryCard summary={null} loading={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows total message count', () => {
    const { container } = render(<SessionSummaryCard summary={BASE_SUMMARY} loading={false} />);
    expect(container.textContent).toContain('5');
  });

  it('shows per-role breakdown', () => {
    const { container } = render(<SessionSummaryCard summary={BASE_SUMMARY} loading={false} />);
    expect(container.textContent).toContain('user');
    expect(container.textContent).toContain('assistant');
    expect(container.textContent).toContain('tool');
  });

  it('shows the session status label', () => {
    render(<SessionSummaryCard summary={BASE_SUMMARY} loading={false} />);
    expect(screen.getByText('Idle')).toBeDefined();
  });

  it('shows the session age', () => {
    const { container } = render(<SessionSummaryCard summary={BASE_SUMMARY} loading={false} />);
    // createdAt is ~65s ago → formatTimeAgo returns "1m ago"
    expect(container.textContent).toContain('1m ago');
  });

  it('renders the session summary aria label', () => {
    render(<SessionSummaryCard summary={BASE_SUMMARY} loading={false} />);
    expect(screen.getByRole('region', { name: 'Session summary' })).toBeDefined();
  });

  it('handles empty messages array gracefully', () => {
    const emptySummary: SessionSummary = {
      ...BASE_SUMMARY,
      totalMessages: 0,
      messages: [],
    };
    const { container } = render(<SessionSummaryCard summary={emptySummary} loading={false} />);
    // Should not show role breakdown section
    expect(container.textContent).not.toContain('By role');
    expect(container.textContent).toContain('0');
  });
});
