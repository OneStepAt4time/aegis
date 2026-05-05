/**
 * __tests__/DriverControlBar.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DriverControlBar } from '../components/session/DriverControlBar';
import type { AcpSessionParticipants } from '../types/acp-driver-observer';

const mockParticipants: AcpSessionParticipants = {
  driver: { sessionId: 's1', subscriberId: 'user-1', role: 'driver' },
  observers: [
    { sessionId: 's1', subscriberId: 'user-2', role: 'observer' },
    { sessionId: 's1', subscriberId: 'user-3', role: 'observer' },
  ],
  activeCount: 3,
};

const noDriverParticipants: AcpSessionParticipants = {
  driver: null,
  observers: [
    { sessionId: 's1', subscriberId: 'user-2', role: 'observer' },
  ],
  activeCount: 1,
};

describe('DriverControlBar', () => {
  it('shows "No driver claimed" when no driver', () => {
    render(<DriverControlBar participants={noDriverParticipants} isDriver={false} />);
    expect(screen.getByText('No driver claimed')).toBeDefined();
  });

  it('shows claim driver button when no driver', () => {
    render(<DriverControlBar participants={noDriverParticipants} isDriver={false} />);
    expect(screen.getByLabelText('Claim driver role')).toBeDefined();
  });

  it('shows driver name when driver exists', () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={false} />);
    expect(screen.getByText('user-1')).toBeDefined();
  });

  it('shows "You" badge when current user is driver', () => {
    render(<DriverControlBar participants={mockParticipants} currentUserId="user-1" isDriver={true} />);
    expect(screen.getByText('You')).toBeDefined();
  });

  it('shows release and transfer buttons when user is driver', () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={true} />);
    expect(screen.getByLabelText('Release driver role')).toBeDefined();
    expect(screen.getByLabelText('Transfer driver role')).toBeDefined();
  });

  it('shows request transfer button for operator when another user is driver', () => {
    render(
      <DriverControlBar
        participants={mockParticipants}
        currentUserId="user-2"
        isDriver={false}
        userRole="operator"
      />
    );
    expect(screen.getByLabelText('Request driver transfer')).toBeDefined();
  });

  it('does not show request transfer for observer role', () => {
    render(
      <DriverControlBar
        participants={mockParticipants}
        currentUserId="user-2"
        isDriver={false}
        userRole="observer"
      />
    );
    expect(screen.queryByLabelText('Request driver transfer')).toBeNull();
  });

  it('shows observer list with count', () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={false} />);
    expect(screen.getByText('Observers (2)')).toBeDefined();
  });

  it('shows observer names', () => {
    render(<DriverControlBar participants={mockParticipants} currentUserId="user-3" isDriver={false} />);
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('user-2')).toBeDefined();
  });

  it('shows connected count', () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={false} />);
    expect(screen.getByText('3 connected')).toBeDefined();
  });

  it('calls onClaim when claim button clicked', async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(<DriverControlBar participants={noDriverParticipants} isDriver={false} onClaim={onClaim} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Claim driver role'));
    });
    expect(onClaim).toHaveBeenCalled();
  });

  it('calls onRelease when release button clicked', async () => {
    const onRelease = vi.fn().mockResolvedValue(undefined);
    render(<DriverControlBar participants={mockParticipants} isDriver={true} onRelease={onRelease} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Release driver role'));
    });
    expect(onRelease).toHaveBeenCalled();
  });

  it('shows transfer form when transfer button clicked', async () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={true} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Transfer driver role'));
    });
    expect(screen.getByLabelText('Transfer driver to (subscriber ID)')).toBeDefined();
  });

  it('calls onTransfer with target and reason', async () => {
    const onTransfer = vi.fn().mockResolvedValue(undefined);
    render(
      <DriverControlBar
        participants={mockParticipants}
        isDriver={true}
        onTransfer={onTransfer}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Transfer driver role'));
    });
    const targetInput = screen.getByLabelText('Transfer driver to (subscriber ID)');
    const reasonInput = screen.getByLabelText('Reason (optional)');
    await act(async () => {
      fireEvent.change(targetInput, { target: { value: 'user-2' } });
      fireEvent.change(reasonInput, { target: { value: 'handoff' } });
      fireEvent.click(screen.getByLabelText('Confirm transfer'));
    });
    expect(onTransfer).toHaveBeenCalledWith('user-2', 'handoff');
  });

  it('displays error and clear button', () => {
    const onClearError = vi.fn();
    render(
      <DriverControlBar
        participants={noDriverParticipants}
        isDriver={false}
        error="Transfer failed"
        onClearError={onClearError}
      />
    );
    expect(screen.getByText('Transfer failed')).toBeDefined();
    expect(screen.getByLabelText('Dismiss error')).toBeDefined();
  });

  it('clears error on dismiss', async () => {
    const onClearError = vi.fn();
    render(
      <DriverControlBar
        participants={noDriverParticipants}
        isDriver={false}
        error="Transfer failed"
        onClearError={onClearError}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss error'));
    });
    expect(onClearError).toHaveBeenCalled();
  });

  it('disables buttons when loading', () => {
    render(
      <DriverControlBar
        participants={noDriverParticipants}
        isDriver={false}
        isLoading={true}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Claim driver role').hasAttribute('disabled')).toBe(true);
  });

  it('has toolbar role with accessible label', () => {
    render(<DriverControlBar participants={noDriverParticipants} isDriver={false} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Session driver and observer controls');
  });

  it('cancels transfer form', async () => {
    render(<DriverControlBar participants={mockParticipants} isDriver={true} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Transfer driver role'));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Cancel transfer'));
    });
    expect(screen.queryByLabelText('Transfer driver to (subscriber ID)')).toBeNull();
  });
});
