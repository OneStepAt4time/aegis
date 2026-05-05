/**
 * __tests__/AcpSessionShell.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AcpSessionShell } from '../components/session/AcpSessionShell';

function renderShell(props: Partial<React.ComponentProps<typeof AcpSessionShell>> = {}) {
  return render(
    <AcpSessionShell
      sessionId="test-session-123"
      {...props}
      children={{
        chat: <div data-testid="chat-content">Chat content</div>,
        terminal: <div data-testid="terminal-content">Terminal content</div>,
        timeline: <div data-testid="timeline-content">Timeline content</div>,
        transcript: <div data-testid="transcript-content">Transcript content</div>,
      }}
    />
  );
}

describe('AcpSessionShell', () => {
  it('renders session ID prefix in status bar', () => {
    renderShell();
    expect(screen.getByText('test-ses')).toBeDefined();
  });

  it('renders session status when provided', () => {
    renderShell({ sessionStatus: 'running' });
    expect(screen.getByText('running')).toBeDefined();
  });

  it('renders tab bar with all default tabs', () => {
    renderShell();
    expect(screen.getByLabelText('Session views')).toBeDefined();
    expect(screen.getByRole('tab', { name: /Chat/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Terminal/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Timeline/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Transcript/ })).toBeDefined();
  });

  it('defaults to chat tab', () => {
    renderShell();
    const chatTab = screen.getByRole('tab', { name: /Chat/ });
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
  });

  it('shows chat content by default', () => {
    renderShell();
    expect(screen.getByTestId('chat-content')).toBeDefined();
  });

  it('switches tabs on click', () => {
    renderShell();
    fireEvent.click(screen.getByRole('tab', { name: /Terminal/ }));
    expect(screen.getByTestId('terminal-content')).toBeDefined();
  });

  it('hides inactive tab panels', () => {
    renderShell();
    // Chat is active, transcript panel should be hidden
    const transcriptPanel = document.getElementById('tabpanel-transcript');
    expect(transcriptPanel?.getAttribute('hidden')).toBe('');
  });

  it('shows active tab indicator', () => {
    renderShell();
    const chatTab = screen.getByRole('tab', { name: /Chat/ });
    // Active tab has a child span with the indicator
    const indicator = chatTab.querySelector('span.absolute');
    expect(indicator).not.toBeNull();
  });

  it('respects defaultTab config', () => {
    renderShell({ config: { defaultTab: 'terminal' } });
    const terminalTab = screen.getByRole('tab', { name: /Terminal/ });
    expect(terminalTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders control rail when provided', () => {
    renderShell({ controlRail: <div data-testid="control-rail">Controls</div> });
    expect(screen.getByTestId('control-rail')).toBeDefined();
    expect(screen.getByRole('complementary')).toBeDefined();
  });

  it('toggles control rail with button', () => {
    renderShell({ controlRail: <div data-testid="control-rail">Controls</div> });
    // Rail is open by default
    expect(screen.getByTestId('control-rail')).toBeDefined();

    // Close it
    fireEvent.click(screen.getByLabelText('Hide control rail'));
    expect(screen.queryByTestId('control-rail')).toBeNull();

    // Open it again
    fireEvent.click(screen.getByLabelText('Show control rail'));
    expect(screen.getByTestId('control-rail')).toBeDefined();
  });

  it('does not render control rail toggle when no controlRail prop', () => {
    renderShell();
    expect(screen.queryByLabelText('Hide control rail')).toBeNull();
    expect(screen.queryByLabelText('Show control rail')).toBeNull();
  });

  it('shows loading state', () => {
    renderShell({ isLoading: true });
    expect(screen.getByText('Loading session...')).toBeDefined();
  });

  it('shows error state', () => {
    renderShell({ error: 'Session not found' });
    expect(screen.getByText('Session not found')).toBeDefined();
  });

  it('hides content when loading', () => {
    renderShell({ isLoading: true });
    expect(screen.queryByTestId('chat-content')).toBeNull();
  });

  it('shows placeholder for unimplemented tab', () => {
    render(
      <AcpSessionShell
        sessionId="test-123"
        children={{
          chat: <div data-testid="chat-content">Chat</div>,
          terminal: undefined as unknown as React.ReactNode,
          timeline: undefined as unknown as React.ReactNode,
          transcript: undefined as unknown as React.ReactNode,
        }}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Terminal/ }));
    expect(screen.getByText('Terminal view not yet implemented')).toBeDefined();
  });

  it('renders tab badge when provided', () => {
    render(
      <AcpSessionShell
        sessionId="test-123"
        config={{
          tabs: [
            { id: 'chat', label: 'Chat', icon: 'MessageSquare', badge: 3 },
            { id: 'terminal', label: 'Terminal', icon: 'Terminal' },
            { id: 'timeline', label: 'Timeline', icon: 'Clock' },
            { id: 'transcript', label: 'Transcript', icon: 'FileText' },
          ],
        }}
        children={{
          chat: <div>Chat</div>,
          terminal: <div>Terminal</div>,
          timeline: <div>Timeline</div>,
          transcript: <div>Transcript</div>,
        }}
      />
    );
    expect(screen.getByText('3')).toBeDefined();
  });

  it('disables tab when disabled flag is set', () => {
    render(
      <AcpSessionShell
        sessionId="test-123"
        config={{
          tabs: [
            { id: 'chat', label: 'Chat', icon: 'MessageSquare' },
            { id: 'terminal', label: 'Terminal', icon: 'Terminal', disabled: true },
            { id: 'timeline', label: 'Timeline', icon: 'Clock' },
            { id: 'transcript', label: 'Transcript', icon: 'FileText' },
          ],
        }}
        children={{
          chat: <div>Chat</div>,
          terminal: <div>Terminal</div>,
          timeline: <div>Timeline</div>,
          transcript: <div>Transcript</div>,
        }}
      />
    );
    const terminalTab = screen.getByRole('tab', { name: /Terminal/ });
    expect(terminalTab.hasAttribute('disabled')).toBe(true);
  });

  it('sets data-session-id on root element', () => {
    renderShell();
    const shell = document.querySelector('[data-session-id]');
    expect(shell?.getAttribute('data-session-id')).toBe('test-session-123');
  });

  it('control rail has accessible label', () => {
    renderShell({ controlRail: <div>Controls</div> });
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Session controls');
  });
});
