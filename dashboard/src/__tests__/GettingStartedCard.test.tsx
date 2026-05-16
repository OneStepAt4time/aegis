/**
 * __tests__/GettingStartedCard.test.tsx
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GettingStartedCard from '../components/shared/GettingStartedCard';

const CLI_COMMAND = 'ag create "Build a hello world"';

describe('GettingStartedCard', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders when totalSessions < 3', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
    expect(screen.getByText('Create First Session')).toBeTruthy();
  });

  it('does not render when totalSessions >= 3', () => {
    render(<GettingStartedCard totalSessions={3} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('does not render when totalSessions > 3', () => {
    render(<GettingStartedCard totalSessions={10} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('calls onCreateSession when CTA is clicked', () => {
    const onCreate = vi.fn();
    render(<GettingStartedCard totalSessions={0} onCreateSession={onCreate} />);
    fireEvent.click(screen.getByText('Create First Session'));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('dismisses and sets localStorage', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Dismiss getting started card'));
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
    expect(localStorage.getItem('aegis-getting-started-dismissed')).toBe('true');
  });

  it('does not render if previously dismissed', () => {
    localStorage.setItem('aegis-getting-started-dismissed', 'true');
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('renders for 1 and 2 sessions', () => {
    const { rerender } = render(
      <GettingStartedCard totalSessions={1} onCreateSession={vi.fn()} />
    );
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();

    rerender(<GettingStartedCard totalSessions={2} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
  });

  it('renders inline CLI command hint', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText(CLI_COMMAND)).toBeTruthy();
  });

  it('copies CLI command to clipboard on copy button click', async () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const copyBtn = screen.getByLabelText('Copy command');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CLI_COMMAND);
    expect(screen.getByLabelText('Copied!')).toBeTruthy();
  });
});
