/**
 * __tests__/AcpApprovalPanel.test.tsx — Tests for wired ACP approval panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcpApprovalPanel } from '../components/session/AcpApprovalPanel';

const mockUseAcpApproval = vi.fn();
vi.mock('../hooks/useAcpApproval', () => ({
  useAcpApproval: (...args: unknown[]) => mockUseAcpApproval(...args),
}));

const defaultReturn = {
  approval: null,
  countdown: null,
  isExpired: false,
  isLoading: false,
  error: null,
  clearError: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
};

describe('AcpApprovalPanel', () => {
  beforeEach(() => {
    mockUseAcpApproval.mockReturnValue(defaultReturn);
  });

  it('shows empty state when no approval pending', () => {
    render(<AcpApprovalPanel sessionId="s1" />);
    expect(screen.getByText('No pending approvals')).not.toBeNull();
  });

  it('renders approval modal when approval is pending', () => {
    mockUseAcpApproval.mockReturnValue({
      ...defaultReturn,
      approval: {
        id: 'apr-1',
        sessionId: 's1',
        tool: {
          toolName: 'bash',
          description: 'Run a shell command',
          riskLevel: 'high',
          input: { command: 'rm -rf /tmp/test' },
        },
        requestedAt: new Date().toISOString(),
        ttlMs: 30000,
      },
      countdown: '00:30',
    });

    render(<AcpApprovalPanel sessionId="s1" />);
    expect(screen.getByText('bash')).not.toBeNull();
    expect(screen.getByText('Run a shell command')).not.toBeNull();
  });
});
