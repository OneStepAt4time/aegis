/**
 * WelcomeScreen.test.tsx — Tests for the first-run welcome screen.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

import WelcomeScreen from '../WelcomeScreen';

// Need to wrap in router since component uses useNavigate
function renderWelcome() {
  return render(
    <MemoryRouter>
      <WelcomeScreen />
    </MemoryRouter>,
  );
}

describe('WelcomeScreen', () => {
  it('renders the welcome heading', () => {
    renderWelcome();
    expect(screen.getByText('Welcome to Aegis')).toBeDefined();
  });

  it('renders the tagline', () => {
    renderWelcome();
    expect(screen.getByText(/Your coding agents, managed/)).toBeDefined();
  });

  it('renders Connect Telegram button', () => {
    renderWelcome();
    const cta = screen.getByRole('button', { name: /connect telegram/i });
    expect(cta).toBeDefined();
  });

  it('renders CLI command hint', () => {
    renderWelcome();
    expect(screen.getByText(/ag run "hello world"/)).toBeDefined();
  });

  it('renders copy button for CLI command', () => {
    renderWelcome();
    expect(screen.getByRole('button', { name: /copy command/i })).toBeDefined();
  });

  it('renders the "or get started" divider text', () => {
    renderWelcome();
    expect(screen.getByText(/or get started from the CLI/)).toBeDefined();
  });

  it('renders approve from phone subtext', () => {
    renderWelcome();
    expect(screen.getByText(/Approve sessions from your phone/)).toBeDefined();
  });
});
