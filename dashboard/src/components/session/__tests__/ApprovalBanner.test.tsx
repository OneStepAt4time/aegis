/**
 * ApprovalBanner.test.tsx — Tests for permission prompt banner.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ApprovalBanner } from '../ApprovalBanner';

// Mock framer-motion to avoid animation overhead in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('ApprovalBanner', () => {
  it('renders permission prompt', () => {
    render(<ApprovalBanner prompt="Allow file write to /src/index.ts?" />);
    expect(screen.getByText('Permission Required')).toBeTruthy();
    expect(screen.getByText('Allow file write to /src/index.ts?')).toBeTruthy();
  });

  it('renders APPROVE and REJECT buttons', () => {
    render(<ApprovalBanner prompt="Allow?" />);
    expect(screen.getByText('APPROVE')).toBeTruthy();
    expect(screen.getByText('REJECT')).toBeTruthy();
  });

  it('calls onApprove when approve clicked', () => {
    const onApprove = vi.fn();
    render(<ApprovalBanner prompt="Allow?" onApprove={onApprove} />);
    fireEvent.click(screen.getByText('APPROVE'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('calls onReject when reject clicked', () => {
    const onReject = vi.fn();
    render(<ApprovalBanner prompt="Allow?" onReject={onReject} />);
    fireEvent.click(screen.getByText('REJECT'));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('shows auto-approved state for bypassPermissions', () => {
    render(<ApprovalBanner prompt="Allow?" permissionMode="bypassPermissions" />);
    expect(screen.getByText(/Auto-approved/)).toBeTruthy();
    expect(screen.queryByText('APPROVE')).toBeNull();
  });

  it('shows auto-approved state for dontAsk', () => {
    render(<ApprovalBanner prompt="Allow?" permissionMode="dontAsk" />);
    expect(screen.getByText(/Auto-approved/)).toBeTruthy();
  });

  it('shows normal prompt for default permission mode', () => {
    render(<ApprovalBanner prompt="Allow?" permissionMode="default" />);
    expect(screen.getByText('APPROVE')).toBeTruthy();
  });

  it('renders countdown label when provided', () => {
    render(<ApprovalBanner prompt="Allow?" countdownLabel="2m 30s" />);
    expect(screen.getByText('TTL 2m 30s')).toBeTruthy();
  });

  it('does not render countdown label when omitted', () => {
    render(<ApprovalBanner prompt="Allow?" />);
    expect(screen.queryByText(/TTL/)).toBeNull();
  });

  it('toggles prompt expansion on click', () => {
    render(<ApprovalBanner prompt="Short prompt" />);
    const promptEl = screen.getByText('Short prompt');
    expect(promptEl.className).toContain('truncate');
    fireEvent.click(promptEl);
    expect(promptEl.className).toContain('break-words');
  });

  it('prevents double-click duplicate approve requests', async () => {
    let resolveApprove: () => void;
    const onApprove = vi.fn(() => new Promise<void>((r) => { resolveApprove = r; }));
    render(<ApprovalBanner prompt="Allow?" onApprove={onApprove} />);

    const approveBtn = screen.getByText('APPROVE');
    // First click
    await act(async () => { fireEvent.click(approveBtn); });
    // Second click while first is in-flight — handler should be blocked by isLoading
    await act(async () => { fireEvent.click(approveBtn); });
    // Only one call should have been made
    expect(onApprove).toHaveBeenCalledOnce();

    // Resolve the promise to clean up
    await act(async () => { resolveApprove!(); });
  });

  it('prevents double-click duplicate reject requests', async () => {
    let resolveReject: () => void;
    const onReject = vi.fn(() => new Promise<void>((r) => { resolveReject = r; }));
    render(<ApprovalBanner prompt="Allow?" onReject={onReject} />);

    const rejectBtn = screen.getByText('REJECT');
    await act(async () => { fireEvent.click(rejectBtn); });
    await act(async () => { fireEvent.click(rejectBtn); });
    expect(onReject).toHaveBeenCalledOnce();

    await act(async () => { resolveReject!(); });
  });

  it('disables both buttons while an action is in-flight', async () => {
    let resolve: () => void;
    const onApprove = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const onReject = vi.fn();
    render(<ApprovalBanner prompt="Allow?" onApprove={onApprove} onReject={onReject} />);

    // Find buttons by their initial text, then click approve
    const buttons = screen.getAllByRole('button');
    // The approve button is the one that says APPROVE (not the expand toggle)
    const approveBtn = buttons.find(b => b.textContent === 'APPROVE')!;
    const rejectBtn = buttons.find(b => b.textContent === 'REJECT')!;

    await act(async () => { fireEvent.click(approveBtn); });

    // Reject button should be disabled while approve is in-flight
    await act(async () => { fireEvent.click(rejectBtn); });
    expect(onReject).not.toHaveBeenCalled();

    await act(async () => { resolve!(); });
  });
});
