/**
 * ApprovalBanner.test.tsx — Tests for permission prompt banner.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
