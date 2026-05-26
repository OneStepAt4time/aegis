import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockOpenTerminal = vi.fn();
const mockSendTerminalInput = vi.fn();
const mockResizeTerminal = vi.fn();
const mockReconnectTerminal = vi.fn();
const mockCloseTerminal = vi.fn();

vi.mock('../../api/acp-terminal-client', () => ({
  openTerminal: (...args: unknown[]) => mockOpenTerminal(...args),
  sendTerminalInput: (...args: unknown[]) => mockSendTerminalInput(...args),
  resizeTerminal: (...args: unknown[]) => mockResizeTerminal(...args),
  reconnectTerminal: (...args: unknown[]) => mockReconnectTerminal(...args),
  closeTerminal: (...args: unknown[]) => mockCloseTerminal(...args),
}));

describe('useTerminalDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disconnected state when no sessionId', async () => {
    const { useTerminalDebug } = await import('../useTerminalDebug');
    const { result } = renderHook(() => useTerminalDebug(undefined));
    expect(result.current.terminalState).toBe('disconnected');
    expect(result.current.terminalId).toBeNull();
    expect(result.current.output).toBe('');
  });

  it('auto-opens terminal and sets connected state', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });

    const { useTerminalDebug } = await import('../useTerminalDebug');
    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => {
      expect(result.current.terminalState).toBe('connected');
      expect(result.current.terminalId).toBe('term-1');
    });

    expect(mockOpenTerminal).toHaveBeenCalledWith('session-1');
  });

  it('sends input and appends to output', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockSendTerminalInput.mockResolvedValue(undefined);

    const { useTerminalDebug } = await import('../useTerminalDebug');
    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.sendInput('ls -la');
    });

    expect(mockSendTerminalInput).toHaveBeenCalledWith('session-1', 'term-1', 'ls -la');
    expect(result.current.output).toContain('ls -la');
  });

  it('closes terminal and resets state', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockCloseTerminal.mockResolvedValue(undefined);

    const { useTerminalDebug } = await import('../useTerminalDebug');
    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.close();
    });

    expect(result.current.terminalState).toBe('disconnected');
    expect(result.current.terminalId).toBeNull();
    expect(result.current.output).toBe('');
  });

  it('sets error state on open failure', async () => {
    mockOpenTerminal.mockRejectedValue(new Error('Connection refused'));

    const { useTerminalDebug } = await import('../useTerminalDebug');
    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => {
      expect(result.current.terminalState).toBe('error');
      expect(result.current.error).toBe('Connection refused');
    });
  });
});
