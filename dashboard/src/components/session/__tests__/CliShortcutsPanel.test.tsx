/**
 * CliShortcutsPanel.test.tsx — Tests for contextual CLI command shortcuts panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CliShortcutsPanel } from '../CliShortcutsPanel';

const SESSION_ID = 'abcdef1234567890';
const SHORT_ID = SESSION_ID.slice(0, 8); // 'abcdef12'

describe('CliShortcutsPanel', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders all 5 commands with correct command text', () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} />);

    // expand the panel first (collapsed by default on "old" sessions)
    const toggle = screen.getByRole('button', { name: /CLI Shortcuts/i });
    fireEvent.click(toggle);

    expect(screen.getByText(`ag read ${SHORT_ID}`)).toBeDefined();
    expect(screen.getByText(`ag tail ${SHORT_ID}`)).toBeDefined();
    expect(screen.getByText(`ag status ${SHORT_ID}`)).toBeDefined();
    expect(screen.getByText(`ag kill ${SHORT_ID}`)).toBeDefined();
    expect(screen.getByText('ag list')).toBeDefined();
  });

  it('copy button writes full session ID to clipboard and shows feedback', async () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} />);

    const toggle = screen.getByRole('button', { name: /CLI Shortcuts/i });
    fireEvent.click(toggle);

    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`ag read ${SESSION_ID}`);
    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('is collapsed by default when session is old', () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} createdAt={Date.now() - 120_000} />);

    // panel body should not be visible
    expect(screen.queryByText(`ag read ${SHORT_ID}`)).toBeNull();
  });

  it('expands on header click', () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} createdAt={Date.now() - 120_000} />);

    expect(screen.queryByText(`ag read ${SHORT_ID}`)).toBeNull();

    const toggle = screen.getByRole('button', { name: /CLI Shortcuts/i });
    fireEvent.click(toggle);

    expect(screen.getByText(`ag read ${SHORT_ID}`)).toBeDefined();
  });

  it('auto-expands when session is less than 60 seconds old', () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} createdAt={Date.now() - 10_000} />);

    // Should be expanded without any click
    expect(screen.getByText(`ag read ${SHORT_ID}`)).toBeDefined();
  });

  it('displays truncated session ID (8 chars) in code but full ID in title attribute', () => {
    render(<CliShortcutsPanel sessionId={SESSION_ID} />);

    const toggle = screen.getByRole('button', { name: /CLI Shortcuts/i });
    fireEvent.click(toggle);

    const codeEl = screen.getByText(`ag read ${SHORT_ID}`);
    expect(codeEl.closest('[title]')?.getAttribute('title')).toBe(`ag read ${SESSION_ID}`);
  });
});
