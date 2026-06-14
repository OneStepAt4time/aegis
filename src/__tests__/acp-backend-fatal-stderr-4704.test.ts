/**
 * Issue #4704: CC session halts on tool failure — no retry or approval surfacing.
 *
 * When CC emits fatal errors on stderr (e.g. "No onPostToolUseHook"),
 * Aegis must detect the bad state and trigger runtime shutdown so the
 * session transitions to `runtime_failed` rather than hanging indefinitely.
 */

import { describe, it, expect } from 'vitest';
import {
  AcpChildProcess,
  type AcpChildProcessOutputEvent,
  type AcpChildProcessSpawnedEvent,
  type AcpChildProcessErrorEvent,
  AcpChildProcessExitEvent,
} from '../services/acp/child-process.js';
import { createDefaultAcpBackendClient } from '../services/acp/backend/utils.js';
import type { AcpBackendClientFactoryContext } from '../services/acp/backend/types.js';

// Minimal mock child process that supports the events we need.
class MockChildProcess extends AcpChildProcess {
  private _stderrListeners = new Set<(event: AcpChildProcessOutputEvent) => void>();
  private _exitListeners = new Set<(event: AcpChildProcessExitEvent) => void>();
  private _killed = false;

  constructor() {
    super({ cwd: '/tmp', env: {} });
  }

  override on(event: 'stdout', listener: (event: AcpChildProcessOutputEvent) => void): this;
  override on(event: 'stderr', listener: (event: AcpChildProcessOutputEvent) => void): this;
  override on(event: 'spawned', listener: (event: AcpChildProcessSpawnedEvent) => void): this;
  override on(event: 'exit', listener: (event: AcpChildProcessExitEvent) => void): this;
  override on(event: 'error', listener: (event: AcpChildProcessErrorEvent) => void): this;
  override on(
    event: 'stdout' | 'stderr' | 'spawned' | 'exit' | 'error',
    listener:
      | ((event: AcpChildProcessOutputEvent) => void)
      | ((event: AcpChildProcessSpawnedEvent) => void)
      | ((event: AcpChildProcessExitEvent) => void)
      | ((event: AcpChildProcessErrorEvent) => void)
  ): this {
    if (event === 'stderr') {
      this._stderrListeners.add(listener as (event: AcpChildProcessOutputEvent) => void);
    } else if (event === 'exit') {
      this._exitListeners.add(listener as (event: AcpChildProcessExitEvent) => void);
    }
    return this;
  }

  override shutdown(): Promise<AcpChildProcessExitEvent> {
    this._killed = true;
    const exitEvent: AcpChildProcessExitEvent = { code: 1, signal: null, expected: false, escalated: false };
    for (const listener of this._exitListeners) {
      listener(exitEvent);
    }
    return Promise.resolve(exitEvent);
  }

  simulateStderr(chunk: string): void {
    for (const listener of this._stderrListeners) {
      listener({ chunk });
    }
  }

  get killed(): boolean {
    return this._killed;
  }
}

describe('fatal stderr detection (#4704)', () => {
  const context: AcpBackendClientFactoryContext = {
    durableSessionId: 'test-session-4704',
    backendRunId: 'run-4704',
    cwd: '/tmp',
    tenantId: 'test',
    ownerKeyId: 'test',
    permissionMode: 'bypassPermissions',
  };

  it('triggers shutdown when "No onPostToolUseHook" appears on stderr', async () => {
    const mockChild = new MockChildProcess();
    
    // Create client with injected mock child
    createDefaultAcpBackendClient(context, {
      childProcessOptions: { env: {} },
    }, mockChild);

    // Wait for client setup
    await new Promise(resolve => setTimeout(resolve, 10));

    // Simulate CC emitting the fatal error
    mockChild.simulateStderr('No onPostToolUseHook found for tool use ID: call_abc123');

    // Wait for async shutdown
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify child was shut down
    expect(mockChild.killed).toBe(true);
  });

  it('triggers shutdown for "Error handling request session/prompt"', async () => {
    const mockChild = new MockChildProcess();
    
    createDefaultAcpBackendClient(context, {
      childProcessOptions: { env: {} },
    }, mockChild);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Simulate CC failing to handle a session/prompt request
    mockChild.simulateStderr('Error handling request {\n  jsonrpc: \'2.0\',\n  id: \'aegis-acp-test-1\',\n  method: \'session/prompt\',\n  params: {\n    sessionId: \'test\',\n    ...');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockChild.killed).toBe(true);
  });

  it('ignores non-fatal stderr messages', async () => {
    const mockChild = new MockChildProcess();
    
    createDefaultAcpBackendClient(context, {
      childProcessOptions: { env: {} },
    }, mockChild);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Simulate a harmless stderr message
    mockChild.simulateStderr('Some debug info from CC');
    mockChild.simulateStderr('Warning: deprecated API usage');
    mockChild.simulateStderr('Info: processing tool call');

    await new Promise(resolve => setTimeout(resolve, 50));

    // Child should NOT be killed
    expect(mockChild.killed).toBe(false);
  });
});
