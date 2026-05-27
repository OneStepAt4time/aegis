import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAcpApproval } from '../useAcpApproval';

// Mock API
vi.mock('../../api/acp-approval-client.js', () => ({
  approveTool: vi.fn().mockResolvedValue(undefined),
  rejectTool: vi.fn().mockResolvedValue(undefined),
  getPendingApproval: vi.fn().mockResolvedValue(null),
}));

// Mock approval store
vi.mock('../../store/useApprovalStore', () => ({
  useApprovalStore: {
    getState: () => ({
      pending: new Set(),
      removeApproval: vi.fn(),
    }),
  },
}));

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  static reset() { MockEventSource.instances = []; }
}

beforeEach(() => {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals('EventSource');
});

describe('useAcpApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1' }),
    );

    expect(result.current.approval).toBeNull();
    expect(result.current.countdown).toBeNull();
    expect(result.current.isExpired).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes approve and reject functions', () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1' }),
    );

    expect(typeof result.current.approve).toBe('function');
    expect(typeof result.current.reject).toBe('function');
  });

  it('exposes clearError function', () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1' }),
    );

    expect(typeof result.current.clearError).toBe('function');
  });

  it('creates SSE connection on mount', () => {
    renderHook(() =>
      useAcpApproval({ sessionId: 's1' }),
    );

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('/v1/sessions/s1/sse');
  });

  it('skips SSE connection when autoConnect is false', () => {
    renderHook(() =>
      useAcpApproval({ sessionId: 's1', autoConnect: false }),
    );

    expect(MockEventSource.instances.length).toBe(0);
  });

  it('closes SSE connection on unmount', () => {
    const { unmount } = renderHook(() =>
      useAcpApproval({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];
    unmount();
    expect(es.closed).toBe(true);
  });

  it('sets approval from SSE approval_request event', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1', autoFetch: false }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: { approvalId: 'a1', toolName: 'write_file' },
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.approval).toEqual({
        approvalId: 'a1',
        toolName: 'write_file',
      });
    });
  });

  it('clears approval on approval_resolved event', async () => {
    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1', autoFetch: false }),
    );

    const es = MockEventSource.instances[0];

    // Set approval first
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: { approvalId: 'a1', toolName: 'write_file' },
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.approval).not.toBeNull();
    });

    // Resolve it
    act(() => {
      es.onmessage!({
        data: JSON.stringify({ type: 'approval_resolved' }),
      });
    });

    await waitFor(() => {
      expect(result.current.approval).toBeNull();
    });
  });

  it('clears error via clearError', async () => {
    const { approveTool } = await import('../../api/acp-approval-client.js');
    vi.mocked(approveTool).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useAcpApproval({ sessionId: 's1', autoFetch: false }),
    );

    // Set approval first
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'approval_request',
          approval: { approvalId: 'a1', toolName: 'test' },
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.approval).not.toBeNull();
    });

    // Approve fails
    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBe('Network error');

    // Clear error
    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
