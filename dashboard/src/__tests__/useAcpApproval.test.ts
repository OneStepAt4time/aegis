/**
 * useAcpApproval.test.ts — Tests for the ACP approval React hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAcpApproval } from '../hooks/useAcpApproval.js';

// Mock the API clients
vi.mock('../api/acp-approval-client.js', () => ({
  approveTool: vi.fn(),
  rejectTool: vi.fn(),
  getPendingApproval: vi.fn(),
}));

import { approveTool, rejectTool, getPendingApproval } from '../api/acp-approval-client.js';

const mockedApproveTool = vi.mocked(approveTool);
const mockedRejectTool = vi.mocked(rejectTool);
const mockedGetPending = vi.mocked(getPendingApproval);

// Mock EventSource
interface MockESInstance {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const mockESInstances: MockESInstance[] = [];

class MockEventSource {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockESInstances.push(this as unknown as MockESInstance);
  }
}

// @ts-expect-error — mock
globalThis.EventSource = MockEventSource;

const SAMPLE_APPROVAL = {
  approvalId: 'appr-1',
  sessionId: 'sess-1',
  tool: {
    toolName: 'bash',
    description: 'Run a shell command',
    riskLevel: 'high' as const,
  },
  requestedAt: '2026-05-07T11:59:00Z',
  expiresAt: '2026-05-07T12:00:30Z',
};

describe('useAcpApproval', () => {
  beforeEach(() => {
    mockESInstances.length = 0;
    mockedApproveTool.mockReset();
    mockedRejectTool.mockReset();
    mockedGetPending.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('initializes with no approval', () => {
    mockedGetPending.mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: false }),
    );

    expect(result.current.approval).toBeNull();
    expect(result.current.countdown).toBeNull();
    expect(result.current.isExpired).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches pending approval on mount and updates state', async () => {
    mockedGetPending.mockResolvedValueOnce(SAMPLE_APPROVAL);

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: true, autoConnect: false }),
    );

    // Wait for the promise to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockedGetPending).toHaveBeenCalledWith('sess-1');
    expect(result.current.approval).toEqual(SAMPLE_APPROVAL);
  });

  it('connects to SSE on mount', () => {
    renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    expect(mockESInstances.length).toBe(1);
    expect(mockESInstances[0].url).toContain('/v1/sessions/sess-1/sse');
  });

  it('closes SSE on unmount', () => {
    const { unmount } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    unmount();
    expect(mockESInstances[0].close).toHaveBeenCalled();
  });

  it('handles approval_request SSE event', () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.approval).toEqual(SAMPLE_APPROVAL);
    expect(result.current.isExpired).toBe(false);
  });

  it('handles approval_resolved SSE event', () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    // First set an approval
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.approval).toBeTruthy();

    // Then resolve it
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_resolved',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.approval).toBeNull();
    expect(result.current.countdown).toBeNull();
  });

  it('computes countdown from expiresAt using fake timers', async () => {
    vi.useFakeTimers({ now: new Date('2026-05-07T12:00:00Z') });

    // Approval expires 30s from now
    mockedGetPending.mockResolvedValueOnce(SAMPLE_APPROVAL);

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: true, autoConnect: false }),
    );

    // Let the fetch promise resolve
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.approval).toEqual(SAMPLE_APPROVAL);
    expect(result.current.countdown).toBe('00:30');
  });

  it('marks expired when countdown reaches zero', async () => {
    vi.useFakeTimers({ now: new Date('2026-05-07T12:00:00Z') });

    // Expires in 1 second
    const expiringApproval = {
      ...SAMPLE_APPROVAL,
      expiresAt: '2026-05-07T12:00:01Z',
    };

    mockedGetPending.mockResolvedValueOnce(expiringApproval);

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: true, autoConnect: false }),
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.approval).toEqual(expiringApproval);

    // Advance past expiry
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isExpired).toBe(true);
    expect(result.current.countdown).toBe('00:00');
  });

  it('approves a pending approval via SSE', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    // Set approval via SSE
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.approval).toEqual(SAMPLE_APPROVAL);

    mockedApproveTool.mockResolvedValueOnce({
      sessionId: 'sess-1',
      approvalId: 'appr-1',
      action: 'approved' as const,
      timestamp: '2026-05-07T12:00:00Z',
    });

    await act(async () => {
      await result.current.approve('Looks safe');
    });

    expect(mockedApproveTool).toHaveBeenCalledWith('sess-1', {
      approvalId: 'appr-1',
      reason: 'Looks safe',
    });
    expect(result.current.approval).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('rejects a pending approval via SSE', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    mockedRejectTool.mockResolvedValueOnce({
      sessionId: 'sess-1',
      approvalId: 'appr-1',
      action: 'rejected' as const,
      timestamp: '2026-05-07T12:00:00Z',
    });

    await act(async () => {
      await result.current.reject('Unsafe command');
    });

    expect(mockedRejectTool).toHaveBeenCalledWith('sess-1', {
      approvalId: 'appr-1',
      reason: 'Unsafe command',
    });
    expect(result.current.approval).toBeNull();
  });

  it('sets error on approve failure', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    mockedApproveTool.mockRejectedValueOnce(new Error('Server error'));

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBe('Server error');
    // Approval should still be there (not cleared on error)
    expect(result.current.approval).toEqual(SAMPLE_APPROVAL);
  });

  it('sets error on reject failure', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    mockedRejectTool.mockRejectedValueOnce(new Error('Network failure'));

    await act(async () => {
      await result.current.reject();
    });

    expect(result.current.error).toBe('Network failure');
  });

  it('clears error with clearError', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: true }),
    );

    const es = mockESInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: SAMPLE_APPROVAL,
        }),
      } as unknown as MessageEvent);
    });

    mockedApproveTool.mockRejectedValueOnce(new Error('fail'));

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBe('fail');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('does nothing on approve/reject when no approval exists', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: false, autoConnect: false }),
    );

    await act(async () => {
      await result.current.approve('reason');
    });

    expect(mockedApproveTool).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.reject('reason');
    });

    expect(mockedRejectTool).not.toHaveBeenCalled();
  });

  it('no countdown when approval has no expiresAt', async () => {
    const noExpiry = {
      ...SAMPLE_APPROVAL,
      expiresAt: undefined,
    };

    mockedGetPending.mockResolvedValueOnce(noExpiry);

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 'sess-1', autoFetch: true, autoConnect: false }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.approval).toEqual(noExpiry);
    expect(result.current.countdown).toBeNull();
  });
});
