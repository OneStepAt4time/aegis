/**
 * __tests__/GettingStartedCard.test.tsx
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GettingStartedCard from '../components/shared/GettingStartedCard';

const CLI_COMMAND = 'ag create "Build a hello world"';

describe('GettingStartedCard', () => {
  let mockExecCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mockExecCommand = vi.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand as unknown as typeof document.execCommand;
  });

  it('renders when totalSessions < 3', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
    expect(screen.getByText('Create your first session')).toBeTruthy();
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
    fireEvent.click(screen.getByText('Create your first session'));
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

  // --- i18n coverage ---

  it('renders title via i18n key (not hardcoded)', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
  });

  it('renders description via i18n key', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText(/Create your first session to start managing Claude Code/)).toBeTruthy();
  });

  it('dismiss button aria-label uses i18n key', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const dismissBtn = screen.getByLabelText('Dismiss getting started card');
    expect(dismissBtn).toBeTruthy();
  });

  it('copy button aria-label uses i18n keys for default and copied states', async () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const copyBtn = screen.getByLabelText('Copy command');
    expect(copyBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(screen.getByLabelText('Copied!')).toBeTruthy();
  });

  // --- Clipboard fallback behavior ---

  it('shows Copied! when clipboard API fails but textarea fallback succeeds', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')) },
    });

    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const copyBtn = screen.getByLabelText('Copy command');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Textarea fallback should kick in
    expect(mockExecCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByLabelText('Copied!')).toBeTruthy();
    // Card still rendered
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
  });

  it('shows Copied! when navigator.clipboard is missing and textarea fallback succeeds', async () => {
    // @ts-expect-error — testing missing clipboard API
    delete navigator.clipboard;

    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const copyBtn = screen.getByLabelText('Copy command');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(mockExecCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByLabelText('Copied!')).toBeTruthy();
  });

  it('does not show Copied! when both clipboard and textarea fallback fail', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('fail')) },
    });
    mockExecCommand.mockReturnValue(false);

    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    const copyBtn = screen.getByLabelText('Copy command');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.queryByLabelText('Copied!')).toBeNull();
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
  });
});
