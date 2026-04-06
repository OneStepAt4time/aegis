/**
 * mock-tmux.ts - Mock TmuxManager for Windows CI testing.
 * Issue #1194: Tests should mock TmuxManager so they can run on Windows CI.
 */
import { vi } from 'vitest';

/** All possible TmuxManager methods that need mocking */
export interface MockTmuxManager {
  listWindows(): Promise<Array<{ windowId: string; windowName: string; sessionName?: string }>>;
  createWindow(opts: {
    workDir: string;
    windowName: string;
    claudeCommand?: string;
    resumeSessionId?: string;
    env?: Record<string, string>;
    permissionMode?: string;
    settingsFile?: string;
    autoApprove?: boolean;
  }): Promise<{ windowId: string; windowName: string; freshSessionId?: string }>;
  capturePane(windowId: string): Promise<string>;
  capturePaneDirect(windowId: string): Promise<string>;
  listPanePid(windowId: string): Promise<number | null>;
  isPidAlive(pid: number): Promise<boolean>;
  getWindowHealth(windowId: string): Promise<boolean>;
  windowExists(windowId: string): Promise<boolean>;
  sendKeys(windowId: string, text: string, enter?: boolean): Promise<{ success: boolean }>;
  sendKeysVerified(windowId: string, text: string, maxRetries?: number): Promise<{ success: boolean }>;
  sendSpecialKey(windowId: string, key: string): Promise<{ success: boolean }>;
  killWindow(windowId: string): Promise<{ success: boolean }>;
}

/** Create a mock TmuxManager instance for testing */
export function createMockTmuxManager(options?: {
  windows?: Array<{ windowId: string; windowName: string; sessionName?: string }>;
  paneContent?: string;
  panePid?: number;
  pidAlive?: boolean;
  windowHealth?: boolean;
  windowExistsResult?: boolean;
}): MockTmuxManager {
  const opts = {
    windows: options?.windows ?? [],
    paneContent: options?.paneContent ?? '',
    panePid: options?.panePid ?? 12345,
    pidAlive: options?.pidAlive ?? true,
    windowHealth: options?.windowHealth ?? true,
    windowExistsResult: options?.windowExistsResult ?? true,
  };

  return {
    listWindows: vi.fn().mockResolvedValue(opts.windows),
    createWindow: vi.fn().mockResolvedValue({ windowId: '@1', windowName: 'mock-window', freshSessionId: 'mock-session' }),
    capturePane: vi.fn().mockResolvedValue(opts.paneContent),
    capturePaneDirect: vi.fn().mockResolvedValue(opts.paneContent),
    listPanePid: vi.fn().mockResolvedValue(opts.panePid),
    isPidAlive: vi.fn().mockResolvedValue(opts.pidAlive),
    getWindowHealth: vi.fn().mockResolvedValue(opts.windowHealth),
    windowExists: vi.fn().mockResolvedValue(opts.windowExistsResult),
    sendKeys: vi.fn().mockResolvedValue({ success: true }),
    sendKeysVerified: vi.fn().mockResolvedValue({ success: true }),
    sendSpecialKey: vi.fn().mockResolvedValue({ success: true }),
    killWindow: vi.fn().mockResolvedValue({ success: true }),
  };
}
