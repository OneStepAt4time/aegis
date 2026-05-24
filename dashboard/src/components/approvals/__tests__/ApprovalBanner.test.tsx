/**
 * ApprovalBanner.test.tsx — Tests for the inline approval banner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../api/client', () => ({
  sessionApprove: vi.fn(),
  sessionReject: vi.fn(),
}));

vi.mock('../../../store/useToastStore', () => ({
  useToastStore: (selector: (store: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import { sessionApprove, sessionReject } from '../../../api/client';
import { ApprovalBanner } from '../ApprovalBanner';

describe('ApprovalBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows awaiting approval message', () => {
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Awaiting approval')).toBeDefined();
  });

  it('shows Approve and Reject buttons', () => {
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined();
  });

  it('calls sessionApprove on Approve click', async () => {
    (sessionApprove as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /approve session/i }));
    expect(sessionApprove).toHaveBeenCalledWith('test-123');

    await waitFor(() => {
      expect(screen.getByText('Approved')).toBeDefined();
    });
  });

  it('calls sessionReject on Reject click', async () => {
    (sessionReject as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /reject session/i }));
    expect(sessionReject).toHaveBeenCalledWith('test-123');

    await waitFor(() => {
      expect(screen.getByText('Rejected')).toBeDefined();
    });
  });

  it('has accessible alert role', () => {
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('shows session name in aria-label', () => {
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" sessionName="my-session" />
      </MemoryRouter>,
    );
    const approveBtn = screen.getByRole('button', { name: /approve session my-session/i });
    expect(approveBtn).toBeDefined();
  });
});
