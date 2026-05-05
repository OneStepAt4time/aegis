/**
 * __tests__/TerminalDebugTab.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalDebugTab } from '../components/session/TerminalDebugTab';

describe('TerminalDebugTab', () => {
  it('renders diagnostic warning bar', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByText(/Diagnostic surface/)).toBeDefined();
  });

  it('renders terminal size in toolbar', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByText('80×24')).toBeDefined();
  });

  it('shows read-only mode by default', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByText('Read-only')).toBeDefined();
  });

  it('shows driver mode when configured', () => {
    render(<TerminalDebugTab sessionId="s1" config={{ mode: 'driver' }} />);
    expect(screen.getByText('Driver')).toBeDefined();
  });

  it('shows disconnected state by default', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByText('disconnected')).toBeDefined();
  });

  it('shows connecting state', () => {
    render(<TerminalDebugTab sessionId="s1" terminalState="connecting" />);
    expect(screen.getByText('connecting')).toBeDefined();
    expect(screen.getByText('Connecting to terminal...')).toBeDefined();
  });

  it('shows connected state', () => {
    render(<TerminalDebugTab sessionId="s1" terminalState="connected" />);
    expect(screen.getByText('connected')).toBeDefined();
  });

  it('shows error state with reconnect button', () => {
    render(<TerminalDebugTab sessionId="s1" terminalState="error" onReconnect={() => {}} />);
    expect(screen.getByText('error')).toBeDefined();
    expect(screen.getByLabelText('Reconnect terminal')).toBeDefined();
  });

  it('shows error message when provided', () => {
    render(<TerminalDebugTab sessionId="s1" error="Connection refused" />);
    expect(screen.getByText('Connection refused')).toBeDefined();
  });

  it('hides input area in read-only mode', () => {
    render(<TerminalDebugTab sessionId="s1" terminalState="connected" />);
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
  });

  it('shows input area for driver in connected state', () => {
    render(<TerminalDebugTab sessionId="s1" config={{ mode: 'driver' }} terminalState="connected" />);
    expect(screen.getByLabelText('Terminal input')).toBeDefined();
  });

  it('shows observer notice in read-only connected state', () => {
    render(<TerminalDebugTab sessionId="s1" terminalState="connected" />);
    expect(screen.getByText('Observer mode — terminal is read-only')).toBeDefined();
  });

  it('does not show input for driver when disconnected', () => {
    render(<TerminalDebugTab sessionId="s1" config={{ mode: 'driver' }} terminalState="disconnected" />);
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
  });

  it('has log role for terminal output', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByRole('log')).toBeDefined();
  });

  it('has region role with accessible label', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByRole('region').getAttribute('aria-label')).toBe('Terminal debug view');
  });

  it('toggles fullscreen on button click', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    const btn = screen.getByLabelText('Enter fullscreen');
    fireEvent.click(btn);
    expect(screen.getByLabelText('Exit fullscreen')).toBeDefined();
  });

  it('calls onReconnect when reconnect button clicked', () => {
    render(
      <TerminalDebugTab sessionId="s1" terminalState="error" onReconnect={() => {}} />
    );
    expect(screen.getByLabelText('Reconnect terminal')).toBeDefined();
  });

  it('calls onInput when driver sends command', () => {
    render(
      <TerminalDebugTab sessionId="s1" config={{ mode: 'driver' }} terminalState="connected" />
    );
    expect(screen.getByLabelText('Terminal input')).toBeDefined();
  });

  it('renders mock terminal output', () => {
    render(<TerminalDebugTab sessionId="s1" />);
    expect(screen.getByText(/Waiting for ACP terminal extension/)).toBeDefined();
  });

  it('sets data-session-id', () => {
    render(<TerminalDebugTab sessionId="test-123" />);
    expect(document.querySelector('[data-session-id]')?.getAttribute('data-session-id')).toBe('test-123');
  });

  it('respects custom terminal size config', () => {
    render(
      <TerminalDebugTab
        sessionId="s1"
        config={{ initialSize: { cols: 120, rows: 36 } }}
      />
    );
    expect(screen.getByText('120×36')).toBeDefined();
  });
});
