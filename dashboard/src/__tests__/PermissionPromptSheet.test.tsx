import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PermissionPromptSheet } from '../components/session/PermissionPromptSheet';

describe('PermissionPromptSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a live TTL countdown', () => {
    render(
      <PermissionPromptSheet
        prompt="Allow Claude to deploy?"
        pendingPermission={{
          toolName: 'Bash',
          prompt: 'npm run deploy',
          startedAt: Date.now(),
          timeoutMs: 10_000,
          expiresAt: Date.now() + 10_000,
          remainingMs: 10_000,
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onEscape={vi.fn()}
        onKill={vi.fn()}
      />,
    );

    expect(screen.getByText('0:10')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText('0:07')).toBeDefined();
  });

  it('wires all action buttons', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onEscape = vi.fn();
    const onKill = vi.fn();

    render(
      <PermissionPromptSheet
        prompt="Allow Claude to deploy?"
        pendingPermission={{
          toolName: 'Bash',
          prompt: 'npm run deploy',
          startedAt: Date.now(),
          timeoutMs: 10_000,
          expiresAt: Date.now() + 10_000,
          remainingMs: 10_000,
        }}
        onApprove={onApprove}
        onReject={onReject}
        onEscape={onEscape}
        onKill={onKill}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Escape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kill' }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onKill).toHaveBeenCalledTimes(1);
  });
});
