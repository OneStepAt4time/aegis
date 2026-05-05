/**
 * __tests__/AcpApprovalModal.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AcpApprovalModal } from '../components/session/AcpApprovalModal';
import type { AcpApprovalRequest } from '../types/acp-approval';

const mockApproval: AcpApprovalRequest = {
  approvalId: 'apr-1',
  sessionId: 's1',
  tool: {
    toolName: 'bash',
    description: 'Execute: rm -rf /tmp/build',
    riskLevel: 'high',
    input: { command: 'rm -rf /tmp/build' },
  },
  requestedAt: '2026-05-05T10:00:00Z',
  expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  requestedBy: 'claude-agent',
};

const expiredApproval: AcpApprovalRequest = {
  ...mockApproval,
  expiresAt: new Date(Date.now() - 1000).toISOString(),
};

const noRiskApproval: AcpApprovalRequest = {
  ...mockApproval,
  tool: { ...mockApproval.tool, riskLevel: undefined },
};

describe('AcpApprovalModal', () => {
  it('renders tool name and description', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    expect(screen.getByText('bash')).toBeDefined();
    expect(screen.getByText('Execute: rm -rf /tmp/build')).toBeDefined();
  });

  it('renders risk level badge', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    expect(screen.getByText('High Risk')).toBeDefined();
  });

  it('does not render risk badge when riskLevel is undefined', () => {
    render(<AcpApprovalModal approval={noRiskApproval} />);
    expect(screen.queryByText('High Risk')).toBeNull();
  });

  it('renders TTL countdown', () => {
    render(<AcpApprovalModal approval={mockApproval} countdown="4:59" />);
    expect(screen.getByText('4:59')).toBeDefined();
  });

  it('renders expired state with warning', () => {
    render(<AcpApprovalModal approval={expiredApproval} isExpired={true} countdown="expired" />);
    expect(screen.getByText('Expired')).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('shows approve and reject buttons when not expired', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    expect(screen.getByLabelText('Approve tool')).toBeDefined();
    expect(screen.getByLabelText('Reject tool')).toBeDefined();
  });

  it('shows dismiss button when expired', () => {
    render(<AcpApprovalModal approval={expiredApproval} isExpired={true} />);
    expect(screen.getByLabelText('Dismiss expired approval')).toBeDefined();
    expect(screen.queryByLabelText('Approve tool')).toBeNull();
  });

  it('calls onApprove directly when approve button clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<AcpApprovalModal approval={mockApproval} onApprove={onApprove} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Approve tool'));
    });
    expect(onApprove).toHaveBeenCalledWith(undefined);
  });

  it('shows optional approval reason expand', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    expect(screen.getByText('▶ Add approval reason (optional)')).toBeDefined();
  });

  it('expands approval reason field on click', async () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    await act(async () => {
      fireEvent.click(screen.getByText('▶ Add approval reason (optional)'));
    });
    expect(screen.getByText('▼ Hide')).toBeDefined();
    expect(screen.getByLabelText('Approval reason (for audit log)')).toBeDefined();
  });

  it('shows reject reason form when reject button clicked', async () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Reject tool'));
    });
    expect(screen.getByLabelText('Rejection reason (optional, for audit log)')).toBeDefined();
    expect(screen.getByLabelText('Confirm rejection')).toBeDefined();
  });

  it('calls onReject with reason when confirmed', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<AcpApprovalModal approval={mockApproval} onReject={onReject} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Reject tool'));
    });
    const input = screen.getByLabelText('Rejection reason (optional, for audit log)');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'unsafe' } });
      fireEvent.click(screen.getByLabelText('Confirm rejection'));
    });
    expect(onReject).toHaveBeenCalledWith('unsafe');
  });

  it('cancels reject form', async () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Reject tool'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(screen.queryByLabelText('Rejection reason (optional, for audit log)')).toBeNull();
  });

  it('displays error and clear button', () => {
    const onClearError = vi.fn();
    render(<AcpApprovalModal approval={mockApproval} error="Network error" onClearError={onClearError} />);
    expect(screen.getByText('Network error')).toBeDefined();
    expect(screen.getByLabelText('Dismiss error')).toBeDefined();
  });

  it('clears error on dismiss', async () => {
    const onClearError = vi.fn();
    render(<AcpApprovalModal approval={mockApproval} error="Network error" onClearError={onClearError} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss error'));
    });
    expect(onClearError).toHaveBeenCalled();
  });

  it('disables buttons when loading', () => {
    render(<AcpApprovalModal approval={mockApproval} isLoading={true} />);
    expect(screen.getByLabelText('Approve tool').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Reject tool').hasAttribute('disabled')).toBe(true);
  });

  it('has dialog role with correct aria-label', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Tool approval required');
  });

  it('renders tool input preview toggle', () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    expect(screen.getByText('Show tool input')).toBeDefined();
  });

  it('expands tool input on toggle', async () => {
    render(<AcpApprovalModal approval={mockApproval} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Show tool input'));
    });
    expect(screen.getByText('Hide tool input')).toBeDefined();
  });

  it('does not render tool input preview when input is empty', () => {
    const noInputApproval: AcpApprovalRequest = {
      ...mockApproval,
      tool: { ...mockApproval.tool, input: undefined },
    };
    render(<AcpApprovalModal approval={noInputApproval} />);
    expect(screen.queryByText('Show tool input')).toBeNull();
  });

  it('calls onReject when dismiss expired button clicked', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<AcpApprovalModal approval={expiredApproval} isExpired={true} onReject={onReject} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss expired approval'));
    });
    expect(onReject).toHaveBeenCalled();
  });
});
