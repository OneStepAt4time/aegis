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

import { useTerminalDebug } from '../useTerminalDebug';

describe('useTerminalDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disconnected state when no sessionId', () => {
    const { result } = renderHook(() => useTerminalDebug(undefined));
    expect(result.current.terminalState).toBe('disconnected');
    expect(result.current.terminalId).toBeNull();
    expect(result.current.output).toBe('');
  });

  it('auto-opens terminal and sets connected state', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });

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

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.sendInput('ls -la');
    });

    expect(mockSendTerminalInput).toHaveBeenCalledWith('session-1', 'term-1', 'ls -la');
    expect(result.current.output).toContain('ls -la');
  });

  it('appends to existing output with newline separator', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockSendTerminalInput.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.sendInput('echo first');
    });
    await act(async () => {
      await result.current.sendInput('echo second');
    });

    expect(result.current.output).toBe('$ echo first\n$ echo second');
  });

  it('sets error on sendInput failure', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockSendTerminalInput.mockRejectedValue(new Error('Send failed'));

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.sendInput('bad command');
    });

    expect(result.current.error).toBe('Send failed');
  });

  it('sets error with fallback message on non-Error sendInput rejection', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockSendTerminalInput.mockRejectedValue('string error');

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.sendInput('x');
    });

    expect(result.current.error).toBe('Failed to send input');
  });

  it('closes terminal and resets state', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockCloseTerminal.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.close();
    });

    expect(result.current.terminalState).toBe('disconnected');
    expect(result.current.terminalId).toBeNull();
    expect(result.current.output).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('sets error state on open failure', async () => {
    mockOpenTerminal.mockRejectedValue(new Error('Connection refused'));

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => {
      expect(result.current.terminalState).toBe('error');
      expect(result.current.error).toBe('Connection refused');
    });
  });

  it('sets error with fallback on non-Error open rejection', async () => {
    mockOpenTerminal.mockRejectedValue('unknown');

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => {
      expect(result.current.terminalState).toBe('error');
      expect(result.current.error).toBe('Failed to open terminal');
    });
  });

  it('resizes terminal', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockResizeTerminal.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.resize({ cols: 120, rows: 40 });
    });

    expect(mockResizeTerminal).toHaveBeenCalledWith('session-1', 'term-1', 120, 40);
  });

  it('sets error on resize failure', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockResizeTerminal.mockRejectedValue(new Error('Resize rejected'));

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.resize({ cols: 80, rows: 24 });
    });

    expect(result.current.error).toBe('Resize rejected');
  });

  it('sets error with fallback on non-Error resize rejection', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockResizeTerminal.mockRejectedValue('fail');

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.resize({ cols: 80, rows: 24 });
    });

    expect(result.current.error).toBe('Failed to resize terminal');
  });

  it('reconnects terminal and restores output', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockReconnectTerminal.mockResolvedValue({ replayedOutput: 'restored output' });

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.reconnect();
    });

    expect(result.current.terminalState).toBe('connected');
    expect(result.current.output).toBe('restored output');
    expect(result.current.error).toBeNull();
  });

  it('sets error on reconnect failure', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockReconnectTerminal.mockRejectedValue(new Error('Reconnect failed'));

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.reconnect();
    });

    expect(result.current.terminalState).toBe('error');
    expect(result.current.error).toBe('Reconnect failed');
  });

  it('sets error with fallback on non-Error reconnect rejection', async () => {
    mockOpenTerminal.mockResolvedValue({ terminalId: 'term-1' });
    mockReconnectTerminal.mockRejectedValue('fail');

    const { result } = renderHook(() => useTerminalDebug('session-1'));

    await waitFor(() => expect(result.current.terminalId).toBe('term-1'));

    await act(async () => {
      await result.current.reconnect();
    });

    expect(result.current.error).toBe('Failed to reconnect terminal');
  });

  it('no-ops sendInput when sessionId is missing', async () => {
    const { result } = renderHook(() => useTerminalDebug(undefined));

    await act(async () => {
      await result.current.sendInput('test');
    });

    expect(mockSendTerminalInput).not.toHaveBeenCalled();
  });

  it('no-ops resize when sessionId is missing', async () => {
    const { result } = renderHook(() => useTerminalDebug(undefined));

    await act(async () => {
      await result.current.resize({ cols: 80, rows: 24 });
    });

    expect(mockResizeTerminal).not.toHaveBeenCalled();
  });

  it('no-ops reconnect when sessionId is missing', async () => {
    const { result } = renderHook(() => useTerminalDebug(undefined));

    await act(async () => {
      await result.current.reconnect();
    });

    expect(mockReconnectTerminal).not.toHaveBeenCalled();
  });

  it('no-ops close when sessionId is missing', async () => {
    const { result } = renderHook(() => useTerminalDebug(undefined));

    await act(async () => {
      await result.current.close();
    });

    expect(mockCloseTerminal).not.toHaveBeenCalled();
  });
});
