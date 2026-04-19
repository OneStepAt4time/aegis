import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionStateBadge, uiStateToSessionBadgeStatus } from '../components/session/SessionStateBadge';

describe('SessionStateBadge — renders all 7 badge states', () => {
  it('renders idle state', () => {
    render(<SessionStateBadge status="idle" />);
    expect(screen.getByLabelText('Session status: Idle')).toBeDefined();
    expect(screen.getByText('Idle')).toBeDefined();
  });

  it('renders working state', () => {
    render(<SessionStateBadge status="working" />);
    expect(screen.getByLabelText('Session status: Working')).toBeDefined();
    expect(screen.getByText('Working')).toBeDefined();
  });

  it('renders permission state', () => {
    render(<SessionStateBadge status="permission" />);
    expect(screen.getByLabelText('Session status: Awaiting approval')).toBeDefined();
    expect(screen.getByText('Awaiting approval')).toBeDefined();
  });

  it('renders waiting state', () => {
    render(<SessionStateBadge status="waiting" />);
    expect(screen.getByLabelText('Session status: Waiting for input')).toBeDefined();
    expect(screen.getByText('Waiting for input')).toBeDefined();
  });

  it('renders error state', () => {
    render(<SessionStateBadge status="error" />);
    expect(screen.getByLabelText('Session status: Error')).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('renders compacting state', () => {
    render(<SessionStateBadge status="compacting" />);
    expect(screen.getByLabelText('Session status: Compacting')).toBeDefined();
    expect(screen.getByText('Compacting')).toBeDefined();
  });

  it('renders offline state', () => {
    render(<SessionStateBadge status="offline" />);
    expect(screen.getByLabelText('Session status: Offline')).toBeDefined();
    expect(screen.getByText('Offline')).toBeDefined();
  });

  it('renders unknown state', () => {
    render(<SessionStateBadge status="unknown" />);
    expect(screen.getByLabelText('Session status: Unknown')).toBeDefined();
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('shows offline when wsConnected=false regardless of status', () => {
    render(<SessionStateBadge status="idle" wsConnected={false} />);
    expect(screen.getByLabelText('Session status: Offline')).toBeDefined();
    expect(screen.getByText('Offline')).toBeDefined();
  });

  it('accepts a custom className', () => {
    const { container } = render(<SessionStateBadge status="idle" className="test-class" />);
    expect(container.querySelector('.test-class')).toBeTruthy();
  });
});

describe('uiStateToSessionBadgeStatus', () => {
  it('maps idle', () => expect(uiStateToSessionBadgeStatus('idle', true)).toBe('idle'));
  it('maps working', () => expect(uiStateToSessionBadgeStatus('working', true)).toBe('working'));
  it('maps permission_prompt', () => expect(uiStateToSessionBadgeStatus('permission_prompt', true)).toBe('permission'));
  it('maps bash_approval', () => expect(uiStateToSessionBadgeStatus('bash_approval', true)).toBe('permission'));
  it('maps ask_question', () => expect(uiStateToSessionBadgeStatus('ask_question', true)).toBe('waiting'));
  it('maps waiting_for_input', () => expect(uiStateToSessionBadgeStatus('waiting_for_input', true)).toBe('waiting'));
  it('maps error', () => expect(uiStateToSessionBadgeStatus('error', true)).toBe('error'));
  it('maps compacting', () => expect(uiStateToSessionBadgeStatus('compacting', true)).toBe('compacting'));
  it('maps context_warning', () => expect(uiStateToSessionBadgeStatus('context_warning', true)).toBe('compacting'));
  it('maps unknown states', () => expect(uiStateToSessionBadgeStatus('unknown', true)).toBe('unknown'));
  it('returns offline when alive=false', () => expect(uiStateToSessionBadgeStatus('idle', false)).toBe('offline'));
});
