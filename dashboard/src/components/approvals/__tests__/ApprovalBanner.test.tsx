/**
 * ApprovalBanner.test.tsx — Tests for the inline approval banner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../api/client', () => ({
  quickApprove: vi.fn(),
  quickReject: vi.fn(),
}));

vi.mock('../../../store/useToastStore', () => ({
  useToastStore: (selector: (store: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import { quickApprove, quickReject } from '../../../api/client';
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

  it('calls quickApprove on Approve click', async () => {
    (quickApprove as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /approve session/i }));
    expect(quickApprove).toHaveBeenCalledWith('test-123');

    await waitFor(() => {
      expect(screen.getByText('Approved')).toBeDefined();
    });
  });

  it('calls quickReject on Reject click', async () => {
    (quickReject as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <ApprovalBanner sessionId="test-123" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /reject session/i }));
    expect(quickReject).toHaveBeenCalledWith('test-123');

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
