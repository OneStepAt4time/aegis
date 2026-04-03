import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionSummaryCard } from '../components/session/SessionSummaryCard';
import type { SessionSummary } from '../types';

const fixedNow = new Date('2026-04-03T12:00:00.000Z').valueOf();

const summary: SessionSummary = {
  sessionId: 'session-1',
  windowName: 'Alpha Session',
  status: 'working',
  totalMessages: 5,
  messages: [
    { role: 'user', contentType: 'text', text: 'Start' },
    { role: 'assistant', contentType: 'text', text: 'Working on it' },
    { role: 'assistant', contentType: 'tool_result', text: 'Done' },
    { role: 'system', contentType: 'text', text: 'Reminder' },
    { role: 'reviewer', contentType: 'text', text: 'Looks good' },
  ],
  createdAt: fixedNow - 5 * 60 * 1000,
  lastActivity: fixedNow - 30 * 1000,
  permissionMode: 'acceptEdits',
};

describe('SessionSummaryCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the compact summary metrics and message role breakdown', () => {
    render(<SessionSummaryCard summary={summary} loading={false} />);

    expect(screen.getByText('Session Summary')).toBeDefined();
    expect(screen.getByText('working')).toBeDefined();
    expect(screen.getByText('Started 5m ago')).toBeDefined();
    expect(screen.getByText('Last active 30s ago')).toBeDefined();
    expect(screen.getByText('acceptEdits')).toBeDefined();
    expect(screen.getByText('Total Messages')).toBeDefined();
    expect(screen.getByText('User')).toBeDefined();
    expect(screen.getByText('Assistant')).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
    expect(screen.getByText('Other')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders a loading skeleton while summary data is pending', () => {
    const { container } = render(<SessionSummaryCard summary={null} loading={true} />);
    expect(container.textContent).not.toContain('Session Summary');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders nothing when no summary is available after loading', () => {
    const { container } = render(<SessionSummaryCard summary={null} loading={false} />);
    expect(container.firstChild).toBeNull();
  });
});